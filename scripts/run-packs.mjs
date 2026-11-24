#!/usr/bin/env node
// The tresridge pack runner - the check-profile campaign lane, in the family
// shape (zero dependencies, committed verdict ledger, explicit --adopt).
//
// What it runs: every pack in a packs root (default packs/public), each pack's
// `checks[]` driven over one target tree. A check IS a rule, so the same
// pipeline that judges the shared grammar judges a pack's law.
//
// Two modes, and the difference is the exit contract:
//
//   campaign   a packs root of our own (the default). Each check gets a row,
//              and the row's verdict is pinned in packs/pack-ledger.json. A NEW
//              failing row, or a verdict that moved against the ledger, fails
//              the run; re-baseline is explicit `--adopt`. With no target tree
//              armed every row is BOUNDED - one honest docket, never a fake
//              pass (the family's absent-tree rule).
//
//   fixture    a positional packs dir that is not ours: packstruct's
//              `audit-conformance` drives the loader with a scratch bundle
//              (SPEC section 7). There is no ledger and no target tree; the
//              EXIT CONTRACT is the whole claim - 0 when every pack loads,
//              non-zero with the offending pack named when one refuses.
//
// Verdict taxonomy (family): BOUNDED / PASSED / EXPLOITED.
//
//   node scripts/run-packs.mjs                      # campaign over packs/public
//   node scripts/run-packs.mjs --tree <dir>         # arm a real .tres tree
//   node scripts/run-packs.mjs --adopt              # re-baseline the ledger
//   node scripts/run-packs.mjs /tmp/scratch/packs   # fixture mode (conformance)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTree } from '../src/tres.mjs';
import { lint } from '../src/lint.mjs';
import { VOCABULARY } from '../src/vocabulary.mjs';
import { collectPacks, checksOf, vocabularyOf } from '../src/packs.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_PACKS = join(ROOT, 'packs', 'public');
const LEDGER = join(ROOT, 'packs', 'pack-ledger.json');
const PKG = 'tresridge-pack-runner';

const argv = process.argv.slice(2);
const flagValue = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const adopt = argv.includes('--adopt');
const asJson = argv.includes('--json');

// The positional packs dir. A `--pack` VALUE must never be mistaken for it.
const packSpecs = [];
let packsDirArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--pack') { if (argv[i + 1]) packSpecs.push(argv[i + 1]); i++; continue; }
  if (argv[i] === '--tree' || argv[i] === '--packs') { i++; continue; }
  if (!argv[i].startsWith('-') && packsDirArg === null) packsDirArg = argv[i];
}

const givenDir = packsDirArg ? resolve(process.cwd(), packsDirArg) : resolve(DEFAULT_PACKS);
if (!existsSync(givenDir)) {
  console.error(`${PKG}: packs dir not found: ${givenDir}`);
  process.exit(2);
}
// A conformance bundle root carries its packs under public/ (SPEC section 1's
// directory contract), so the argument may name the bundle rather than the
// packs dir. Normalize before scanning, and remember which we were handed.
const packsRoot = existsSync(join(givenDir, 'public')) ? join(givenDir, 'public') : givenDir;
// Fixture mode: driven by a scratch bundle, so nothing is pinned and no target
// tree is required. Our own root (by path or by basename `public`) is campaign.
const fixtureMode = givenDir !== resolve(DEFAULT_PACKS) && givenDir.split('/').pop() !== 'public';

// The target tree: --tree, else TRESRIDGE_TREE, else the cwd when it already
// looks like a tree root (a relations.json beside family directories). Never a
// guess above or below - an unusable tree is BOUNDED, not a silent pass.
const treeEnv = process.env.TRESRIDGE_TREE;
const treeCandidates = [
  flagValue('--tree') ? resolve(process.cwd(), flagValue('--tree')) : null,
  treeEnv ? resolve(treeEnv) : null,
  existsSync(join(process.cwd(), 'relations.json')) ? resolve(process.cwd()) : null,
].filter(Boolean);

let tree = null;
let treeRoot = null;
let decl = null;
for (const candidate of treeCandidates) {
  if (!existsSync(candidate)) continue;
  const declPath = join(candidate, 'relations.json');
  if (!existsSync(declPath)) continue;
  try {
    tree = readTree(candidate);
    treeRoot = candidate;
    decl = JSON.parse(readFileSync(declPath, 'utf8'));
    break;
  } catch { /* an unreadable candidate is not a target; keep looking */ }
}

let loaded;
try {
  loaded = await collectPacks({ root: packsRoot, specs: packSpecs });
} catch (err) {
  // Every loader refusal is nameable and one-line (SPEC section 5). In fixture
  // mode this IS the verdict: non-zero with the offending pack named.
  console.error(`${PKG}: ${err.message}`);
  process.exit(1);
}

// A pack that loads but carries no checks is only a defect in campaign mode: it
// would sit in the ledger as a vacuous green. A conformance bundle's clean pack
// legitimately audits nothing (its entry is inert by design).
if (!fixtureMode) {
  const empty = loaded.packs.filter((p) => checksOf(p).length === 0);
  if (empty.length) {
    for (const p of empty) console.error(`${PKG}: pack ${p.name}: entry exposes no checks[] - a check-profile pack must declare at least one`);
    process.exit(1);
  }
}

if (fixtureMode) {
  // The exit contract, and nothing else. A skip is reported, never hidden.
  for (const s of loaded.skipped) console.error(`${PKG}: skipped pack ${s.name} (${s.reason}): ${s.detail}`);
  if (asJson) console.log(JSON.stringify({ fixture: true, packsLoaded: loaded.packs.map((p) => p.name), skipped: loaded.skipped }, null, 2));
  else console.log(`${PKG}: ${loaded.packs.length} pack(s) loaded from ${packsRoot}`);
  process.exit(0);
}

// --- campaign -----------------------------------------------------------------

const rows = [];
for (const pack of loaded.packs) {
  const checks = checksOf(pack);
  const vocab = [...VOCABULARY, ...vocabularyOf(pack)];
  if (!tree) {
    for (const c of checks) {
      rows.push({ id: `${pack.name}:${c.code}`, pack: pack.name, verdict: 'BOUNDED', detail: 'no target tree armed - pass --tree <dir> or set TRESRIDGE_TREE' });
    }
    continue;
  }
  const result = lint(tree, decl, { vocabulary: vocab, extraRules: checks.map((c) => ({ ...c, pack: pack.name })) });
  for (const c of checks) {
    const mine = result.violations.filter((v) => v.pack === pack.name && v.code === c.code);
    const warned = result.warnings.filter((w) => w.pack === pack.name && w.code === c.code);
    const verdict = mine.length ? 'EXPLOITED' : warned.length ? 'PASSED' : 'PASSED';
    rows.push({
      id: `${pack.name}:${c.code}`,
      pack: pack.name,
      verdict,
      detail: mine.length ? mine.map((m) => `${m.record}${m.field ? '.' + m.field : ''}: ${m.detail}`).join('; ') : undefined,
    });
  }
}

// The ledger: a committed pin of every row's verdict, so a regression is loud
// and a re-baseline is explicit. Same semantics as the family's crashledger.
let ledger = { schemaVersion: 1, what: 'Pack campaign verdicts. A row that moves against this file fails the run; re-baseline with --adopt.', rows: {} };
if (existsSync(LEDGER)) {
  try {
    ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
    if (!ledger.rows || typeof ledger.rows !== 'object') throw new Error('ledger has no rows object');
  } catch (err) {
    console.error(`${PKG}: ${LEDGER} is unreadable (${err.message}) - fix or delete it to re-baseline`);
    process.exit(2);
  }
}

const findings = [];
for (const row of rows) {
  const prior = ledger.rows[row.id];
  if (!prior) { findings.push({ ...row, why: adopt ? null : 'new row' }); continue; }
  if (prior.verdict !== row.verdict) findings.push({ ...row, why: `verdict moved from ${prior.verdict}` });
}

const regressions = findings.filter((f) => f.why);

if (adopt) {
  const next = { ...ledger, rows: { ...ledger.rows } };
  for (const row of rows) next.rows[row.id] = { verdict: row.verdict, detail: row.detail };
  writeFileSync(LEDGER, JSON.stringify(next, null, 2) + '\n');
}

if (asJson) {
  console.log(JSON.stringify({ schemaVersion: 1, tree: treeRoot, fixture: false, rows, adopted: adopt, regressions: regressions.map((r) => ({ id: r.id, why: r.why, verdict: r.verdict })), skipped: loaded.skipped }, null, 2));
} else {
  for (const s of loaded.skipped) console.log(`  SKIP  ${s.name}  (${s.reason}) ${s.detail}`);
  for (const row of rows) {
    const mark = row.verdict === 'EXPLOITED' ? 'FAIL' : row.verdict === 'BOUNDED' ? 'BOUND' : 'PASS';
    console.log(`  ${mark.padEnd(5)} ${row.id}${row.detail ? '  ' + row.detail : ''}`);
  }
  const counts = rows.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
  console.log(`${PKG}: ${rows.length} row(s) over ${loaded.packs.length} pack(s)${treeRoot ? ` against ${treeRoot}` : ' (no tree armed)'} - ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`);
  if (adopt) console.log(`  ledger re-baselined: ${LEDGER}`);
  for (const r of regressions) console.log(`  MOVE  ${r.id}: ${r.why} -> ${r.verdict}`);
}

process.exit(regressions.length ? 1 : 0);
