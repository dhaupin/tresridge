#!/usr/bin/env node
// tresridge CLI. Exit contract: 0 clean, 1 violations, 2 usage (SPEC section 8).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readTree } from '../src/tres.mjs';
import { lint, validateDeclaration, SCHEMA_VERSION } from '../src/lint.mjs';
import { graph } from '../src/graph.mjs';
import { VOCABULARY } from '../src/vocabulary.mjs';

const USAGE = `tresridge - the .tres relation standard

  tresridge lint <tree> [--decl <file>] [--rules <module>] [--json]
  tresridge graph <tree> [--out <file>] [--json]
  tresridge doctor <tree> [--decl <file>] [--rules <module>]
  tresridge rules [--json]                # the refusal vocabulary this lint carries

  lint     every declared edge resolves; no undeclared _id; no cycles
  graph    infer a first-draft declaration from the tree (writes a draft)
  doctor   lint + graph residue + a summary of what needs declaring
  rules    list the refusal vocabulary (spec/refusals.json), one source

  --rules <module>  a host extension module exporting { rules: [...] }.
                    A rule whose code the vocabulary does not carry is refused.

  Exit: 0 clean, 1 violations, 2 usage.`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const treeArg = argv[1];
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);

if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(cmd ? 0 : 2); }

// `rules` reads only the vocabulary - it needs no tree.
if (cmd === 'rules') {
  if (has('--json')) { console.log(JSON.stringify({ schemaVersion: 1, codes: VOCABULARY, count: VOCABULARY.length }, null, 2)); }
  else {
    console.log(`tresridge rules: ${VOCABULARY.length} refusal codes (spec/refusals.json)`);
    for (const c of VOCABULARY) console.log(`  ${c}`);
  }
  process.exit(0);
}

if (!treeArg || treeArg.startsWith('-')) { console.error(USAGE); process.exit(2); }

const root = resolve(process.cwd(), treeArg);
if (!existsSync(root)) { console.error(`tresridge: tree not found: ${treeArg}`); process.exit(2); }

const declPath = flag('--decl') || 'relations.json';

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
const lintOpts = { vocabulary: VOCABULARY, extraRules: hostRules };

try {
  if (cmd === 'lint') {
    if (!existsSync(declPath)) { console.error(`tresridge: declaration not found: ${declPath} (run \`tresridge graph\` to draft one)`); process.exit(2); }
    const decl = JSON.parse(readFileSync(declPath, 'utf8'));
    const declErrors = validateDeclaration(decl, { vocabulary: VOCABULARY });
    if (declErrors.length) {
      for (const e of declErrors) console.error(`  DECL ${e}`);
      process.exit(1);
    }
    const result = lint(readTree(root), decl, lintOpts);
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
    const { declaration, residue, tree } = graph(root);
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
    const { declaration, residue, tree } = graph(root);
    console.log(`tresridge doctor: ${tree.families.length} families, ${tree.records.length} records`);
    console.log(`  edges inferred:  ${declaration.edges.length}`);
    console.log(`  needs declaring: ${residue.undeclared.length} field(s)`);
    if (existsSync(declPath)) {
      const decl = JSON.parse(readFileSync(declPath, 'utf8'));
      const result = lint(readTree(root), decl, lintOpts);
      console.log(`  declared edges:  ${decl.edges.length}`);
      console.log(`  violations:      ${result.violations.length}`);
      console.log(`  warnings:        ${result.warnings.length}`);
      process.exit(result.violations.length ? 1 : 0);
    }
    console.log(`  declaration:     ${declPath} not found (run \`tresridge graph --out ${declPath}\`)`);
    process.exit(0);
  }

  console.error(USAGE); process.exit(2);
} catch (err) {
  console.error(`tresridge: ${err.message}`);
  process.exit(2);
}
