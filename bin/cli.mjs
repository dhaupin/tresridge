#!/usr/bin/env node
// tresridge CLI. Exit contract: 0 clean, 1 violations, 2 usage (SPEC section 8).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readTree, rootProblem } from '../src/tres.mjs';
import { lint, validateDeclaration, SCHEMA_VERSION } from '../src/lint.mjs';
import { inferFrom, diffDeclaration } from '../src/graph.mjs';
import { VOCABULARY } from '../src/vocabulary.mjs';
import { RULES } from '../src/rules.mjs';
import { collectPacks, checksOf, vocabularyOf, discoverPackDirs, loadPackDir, censusIds } from '../src/packs.mjs';

const USAGE = `tresridge - the .tres relation standard

  tresridge lint <tree> [--decl <file>] [--rules <module>] [--packs <dir>]... [--json]
  tresridge graph <tree> [--out <file>] [--against <file>] [--json]
  tresridge doctor <tree> [--decl <file>] [--rules <module>] [--packs <dir>]... [--json]
  tresridge rules [--json]                # the refusal vocabulary this lint carries
  tresridge lint-packs [<packs-dir>] [--deep] [--json]   # check packs against the spec

  lint     every declared edge resolves; no undeclared _id; no cycles
  graph    infer a first-draft declaration from the tree (writes a draft)
  doctor   lint + graph residue + a summary of what needs declaring
  rules    list the refusal vocabulary (spec/refusals.json), one source

  <tree> is the TREE ROOT: the directory whose children are family directories
  (SPEC section 1). Passing a directory above or below it is refused, not guessed at.

  --decl <file>     the declaration (default: <tree>/relations.json, then ./relations.json)
  --rules <module>  a host extension module exporting { rules: [...] }.
                    A rule whose code the vocabulary does not carry is refused.
  --packs <dir>     a packstruct pack dir, or a packs root whose children are
                    packs (SPEC v1). Repeatable. A pack carries its own
                    vocabulary, so its codes are merged before its rules run.
                    A pack declaring \"requires\" the run root does not provide is
                    skipped by name, never silently.

  Exit: 0 clean, 1 violations, 2 usage.`;


const argv = process.argv.slice(2);
const cmd = argv[0];
const treeArg = argv[1];
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);

if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(cmd ? 0 : 2); }

// The version is read from package.json, never restated: a hand-copied literal
// is a second source that drifts silently from the one npm publishes.
if (cmd === '--version' || cmd === '-v') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

// `rules` reads only the vocabulary - it needs no tree.
if (cmd === 'rules') {
  if (has('--json')) { console.log(JSON.stringify({ schemaVersion: 1, codes: VOCABULARY, count: VOCABULARY.length }, null, 2)); }
  else {
    console.log(`tresridge rules: ${VOCABULARY.length} refusal codes (spec/refusals.json)`);
    for (const c of VOCABULARY) console.log(`  ${c}`);
  }
  process.exit(0);
}

// `lint-packs` judges a packs tree, not a .tres tree, so it runs before the
// tree guard. It is the author-time gate: the same checks `packstruct lint`
// reports, read from the same loader the run path uses.
if (cmd === 'lint-packs') {
  const dirArg = treeArg && !treeArg.startsWith('-') ? treeArg : 'packs/public';
  const dir = isAbsolute(dirArg) ? dirArg : resolve(process.cwd(), dirArg);
  if (!existsSync(dir)) { console.error(`tresridge: packs dir not found: ${dirArg}`); process.exit(2); }
  const deep = has('--deep');
  const violations = [];
  const warnings = [];
  let checked = 0;
  const seen = new Map();
  const dirs = existsSync(join(dir, 'pack.json')) ? [dir] : discoverPackDirs(dir);
  for (const d of dirs) {
    const name = d.split('/').pop();
    let pack;
    try {
      pack = await loadPackDir(d, `packs/${name}`);
    } catch (err) {
      violations.push({ pack: name, code: 'manifest', detail: err.message });
      continue;
    }
    checked++;
    if (seen.has(pack.name)) {
      violations.push({ pack: pack.name, code: 'name-collision', detail: `also declared by ${seen.get(pack.name)}` });
    }
    seen.set(pack.name, d);
    const checks = checksOf(pack);
    // Armed coverage is judged even when the pack declares no checks: a
    // declaration naming a row that does not ship is its own defect (SPEC
    // section 8.6), and hiding it behind the no-checks refusal would bury it.
    if (deep) {
      const armed = pack.spec.armedCoverage;
      if (armed !== undefined) {
        const rel = String(armed);
        const inside = !isAbsolute(rel) && !rel.split('/').includes('..');
        if (!inside || !existsSync(join(pack.dir, rel))) {
          violations.push({ pack: pack.name, code: 'armed-coverage', detail: `armedCoverage names ${JSON.stringify(armed)}, which does not ship inside the pack dir` });
        }
      }
    }
    if (!checks.length) {
      violations.push({ pack: pack.name, code: 'no-checks', detail: 'entry exposes no checks[] - a check-profile pack must declare at least one' });
      continue;
    }
    let vocab = [];
    try {
      vocab = vocabularyOf(pack);
    } catch (err) {
      violations.push({ pack: pack.name, code: 'vocabulary', detail: err.message });
      continue;
    }
    // A check may not invent a code: it must be in the pack's own vocabulary, or
    // the shared one. This is the pack-level twin of the host `unknown-rule` law.
    for (const c of checks) {
      if (typeof c.code !== 'string' || !c.code) {
        violations.push({ pack: pack.name, code: 'check-code', detail: `a check carries no code: ${JSON.stringify(c.code)}` });
      } else if (!vocab.includes(c.code) && !VOCABULARY.includes(c.code)) {
        violations.push({ pack: pack.name, code: 'unknown-rule', detail: `check code ${JSON.stringify(c.code)} is in neither the pack vocabulary nor the shared one` });
      }
    }
    const adds = Array.isArray(pack.spec.adds) ? pack.spec.adds : [];
    for (const code of adds) {
      if (!vocab.includes(code)) warnings.push({ pack: pack.name, code: 'adds-undeclared', detail: `"adds" names ${JSON.stringify(code)} but the vocabulary does not carry it` });
    }
    if (deep) {
      // The host-library census: a pack may not re-use a code the core registry
      // already owns. Re-using one would silently redefine a standing refusal,
      // which is the one thing a pack may never do (SPEC section 12).
      const coreCodes = new Set(RULES.map((r) => r.code));
      for (const c of checks) {
        if (coreCodes.has(c.code) && !VOCABULARY.includes(c.code)) {
          violations.push({ pack: pack.name, code: 'id-library-collision', detail: `check code ${JSON.stringify(c.code)} is already a core rule code` });
        }
      }
      const ids = censusIds(pack);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dupes.length) violations.push({ pack: pack.name, code: 'id-duplicate', detail: `duplicate check ids: ${[...new Set(dupes)].join(', ')}` });
    }
  }
  if (has('--json')) {
    console.log(JSON.stringify({ schemaVersion: 1, packsChecked: checked, deep, violations, warnings }, null, 2));
  } else {
    console.log(`tresridge lint-packs${deep ? ' --deep' : ''}: ${checked} pack(s) checked in ${dirArg}`);
    for (const w of warnings) console.log(`  WARN  ${w.pack} [${w.code}]: ${w.detail}`);
    for (const v of violations) console.log(`  FAIL  ${v.pack} [${v.code}]: ${v.detail}`);
    console.log(`  ${violations.length} violation(s), ${warnings.length} warning(s)`);
  }
  process.exit(violations.length ? 1 : 0);
}

if (!treeArg || treeArg.startsWith('-')) { console.error(USAGE); process.exit(2); }

const root = resolve(process.cwd(), treeArg);
if (!existsSync(root)) { console.error(`tresridge: tree not found: ${treeArg}`); process.exit(2); }

// The declaration default is the tree's OWN relations.json before the cwd's: the
// declaration is the tree's artifact (SPEC section 1), so `doctor data/` must find
// `data/relations.json` from anywhere.
function resolveDecl(spec) {
  if (spec) {
    const p = isAbsolute(spec) ? spec : resolve(process.cwd(), spec);
    return { path: p };
  }
  for (const p of [join(root, 'relations.json'), resolve(process.cwd(), 'relations.json')]) {
    if (existsSync(p)) return { path: p };
  }
  return { path: join(root, 'relations.json') };
}
const declPath = resolveDecl(flag('--decl')).path;


// The extension surface: a host module exporting { rules: [...] }. Loaded by
// absolute path (never a bare specifier), and only ever ADDED to the registry.
async function loadHostRules(spec) {
  if (!spec) return [];
  const p = isAbsolute(spec) ? spec : resolve(process.cwd(), spec);
  if (!existsSync(p)) { console.error(`tresridge: --rules module not found: ${spec}`); process.exit(2); }
  const mod = await import(pathToFileURL(p).href);
  const rules = mod.rules || mod.default?.rules || [];
  if (!Array.isArray(rules)) { console.error(`tresridge: --rules module must export { rules: [...] }`); process.exit(2); }
  return rules;
}
const hostRules = await loadHostRules(flag('--rules'));

// The pack surface (packstruct SPEC v1): a pack is a dir with pack.json, or a
// packs root whose children are packs. A pack's checks ARE rules, and its
// vocabulary is merged before its rules are judged - a pack may not invent a
// code either. `--packs` is repeatable.
function packSpecs() {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--packs') continue;
    const v = argv[i + 1];
    if (!v || v.startsWith('-')) { console.error('tresridge: --packs needs a directory'); process.exit(2); }
    out.push(v);
  }
  return out;
}

async function loadPacks() {
  const specs = packSpecs();
  if (!specs.length) return { rules: [], vocabulary: [], packs: [], skipped: [] };
  const rules = [];
  const vocabulary = [];
  const packs = [];
  const skipped = [];
  for (const spec of specs) {
    const abs = isAbsolute(spec) ? spec : resolve(process.cwd(), spec);
    if (!existsSync(abs)) { console.error(`tresridge: --packs path not found: ${spec}`); process.exit(2); }
    // A dir that carries pack.json is one pack; otherwise it is a packs root.
    const isOnePack = existsSync(join(abs, 'pack.json'));
    const result = isOnePack
      ? await collectPacks({ specs: [abs] })
      : await collectPacks({ root: abs });
    for (const pack of result.packs) {
      const codes = vocabularyOf(pack);
      vocabulary.push(...codes);
      const checks = checksOf(pack);
      if (!checks.length) {
        console.error(`tresridge: pack ${pack.name}: entry exposes no checks[] - a check-profile pack must declare at least one`);
        process.exit(2);
      }
      for (const c of checks) rules.push({ ...c, pack: pack.name });
      packs.push({ name: pack.name, version: pack.spec.version, checks: checks.length, source: pack.source });
    }
    skipped.push(...result.skipped);
  }
  return { rules, vocabulary, packs, skipped };
}

const packLoad = await loadPacks();
const packVocab = packLoad.vocabulary;
const mergedVocabulary = packVocab.length ? [...VOCABULARY, ...packVocab.filter((c) => !VOCABULARY.includes(c))] : VOCABULARY;
const lintOpts = { vocabulary: mergedVocabulary, extraRules: [...hostRules, ...packLoad.rules] };

try {
  // Read the tree once, then hold it to the contract root. A root above or below the
  // tree root reads as a plausible tree and yields a useless graph (0 edges, or one
  // "family" per file), so it is a usage refusal, never a silent pass.
  const tree = readTree(root);
  const rootErr = rootProblem(tree, root);
  if (rootErr) {
    console.error(`tresridge: ${rootErr.code}: ${rootErr.detail}`);
    for (const h of rootErr.hints) console.error(`  try: ${h}`);
    process.exit(2);
  }

  if (cmd === 'lint') {
    if (!existsSync(declPath)) { console.error(`tresridge: declaration not found: ${declPath} (run \`tresridge graph\` to draft one)`); process.exit(2); }
    const decl = JSON.parse(readFileSync(declPath, 'utf8'));
    const declErrors = validateDeclaration(decl, { vocabulary: mergedVocabulary });
    if (declErrors.length) {
      for (const e of declErrors) console.error(`  DECL ${e}`);
      process.exit(1);
    }
    const result = lint(tree, decl, lintOpts);
    if (has('--json')) { console.log(JSON.stringify(result, null, 2)); }
    else {
      console.log(`tresridge lint: ${result.families} families, ${result.records} records, ${result.edges} edges`);
      for (const w of result.warnings) console.log(`  WARN  ${w.code}  ${w.record} .${w.field} -> "${w.target || ''}"`);
      for (const v of result.violations) console.log(`  FAIL  ${v.code}  ${v.record}${v.field ? ' .' + v.field : ''}  ${v.detail}`);
      console.log(`  ${result.violations.length} violation(s), ${result.warnings.length} warning(s)`);
    }
    process.exit(result.violations.length ? 1 : 0);
  }

  if (cmd === 'graph') {
    const { declaration, residue } = inferFrom(tree);
      const against = flag('--against');
      if (against) {
        const againstPath = isAbsolute(against) ? against : resolve(process.cwd(), against);
        if (!existsSync(againstPath)) { console.error(`tresridge: --against declaration not found: ${against}`); process.exit(2); }
        const decl = JSON.parse(readFileSync(againstPath, 'utf8'));
        const { added, removed, changed } = diffDeclaration(declaration, decl, residue);
        if (has('--json')) {
          console.log(JSON.stringify({ added, removed, changed }, null, 2));
        } else {
          for (const e of added) console.log(`  + ${e.family}.${e.field} -> ${JSON.stringify(e.target)} (${e.kind})`);
          for (const e of removed) console.log(`  - ${e.family}.${e.field} -> ${JSON.stringify(e.target)} (${e.kind})`);
          for (const e of changed) console.log(`  ~ ${e.family}.${e.field}: declared ${JSON.stringify(e.declared.target)} (${e.declared.kind}), inferred ${JSON.stringify(e.inferred.target)} (${e.inferred.kind})`);
          console.log(`tresridge graph --against: ${added.length} added, ${removed.length} removed, ${changed.length} changed`);
        }
        process.exit(added.length || removed.length || changed.length ? 1 : 0);
      }
    const out = flag('--out');
    if (out) writeFileSync(out, JSON.stringify(declaration, null, 2) + '\n');
    if (has('--json')) { console.log(JSON.stringify({ declaration, residue }, null, 2)); }
    else {
      console.log(`tresridge graph: ${tree.families.length} families, ${tree.records.length} records, ${declaration.edges.length} edges inferred`);
      console.log(`  residue: ${residue.undeclared.length} field(s) need declaration`);
      for (const u of residue.undeclared.slice(0, 20)) console.log(`    ${String(u.count).padStart(4)}  ${u.family}.${u.field}`);
      if (out) console.log(`  draft written: ${out}`);
    }
    process.exit(0);
  }

  if (cmd === 'doctor') {
    const { declaration, residue } = inferFrom(tree);
    // `doctor` is the verb a host runs FIRST, so a missing declaration cannot be a
    // clean exit: the summary would report zero violations over an unjudged tree.
    // That is the same silent pass the root guard exists to stop.
    if (!existsSync(declPath)) {
      console.error(`tresridge: declaration not found: ${declPath} (run \`tresridge graph --out ${declPath}\` to draft one)`);
      process.exit(2);
    }
    const decl = JSON.parse(readFileSync(declPath, 'utf8'));
    const declErrors = validateDeclaration(decl, { vocabulary: mergedVocabulary });
    if (declErrors.length) {
      for (const e of declErrors) console.error(`  DECL ${e}`);
      process.exit(1);
    }
    const result = lint(tree, decl, lintOpts);
    if (has('--json')) {
      console.log(JSON.stringify({
        families: tree.families.length,
        records: tree.records.length,
        edgesInferred: declaration.edges.length,
        needsDeclaring: residue.undeclared.length,
        declaration: { path: declPath, edges: decl.edges.length },
        violations: result.violations,
        warnings: result.warnings,
      }, null, 2));
    } else {
      console.log(`tresridge doctor: ${tree.families.length} families, ${tree.records.length} records`);
      console.log(`  edges inferred:  ${declaration.edges.length}`);
      console.log(`  needs declaring: ${residue.undeclared.length} field(s)`);
      console.log(`  declared edges:  ${decl.edges.length}`);
      console.log(`  violations:      ${result.violations.length}`);
      console.log(`  warnings:        ${result.warnings.length}`);
    }
    process.exit(result.violations.length ? 1 : 0);
  }

  console.error(USAGE); process.exit(2);
} catch (err) {
  console.error(`tresridge: ${err.message}`);
  process.exit(2);
}
