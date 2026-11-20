#!/usr/bin/env node
/**
 * scripts/gen-refusal-matrix.mjs - the tresridge column of the refusal matrix.
 *
 * No-fiction rule honored mechanically: every row's refusal verdict is observed
 * from the ACTUAL lint run over bytes materialized on disk, never from what the
 * code reads like it would do. A row whose observed verdict disagrees with its
 * expectation REFUSES THE RUN (exit 1) - the matrix can never silently go stale
 * or lie.
 *
 * Outputs, written only when every row proves honest:
 *   labs/refusal-matrix.tresridge.json - the tresridge column
 *   labs/refusal-battery/<id>.json     - portable shape files: hosts run the
 *     same battery through THEIR lint and give back their column.
 *
 * --check: regenerate in memory and diff against the committed files (CI gate).
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTree } from '../src/tres.mjs';
import { lint } from '../src/lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// A clean base tree: two families, one resolvable edge.
const CLEAN = {
  families: [
    { key: 'npcs', schema: 'NpcData', idPrefix: '' },
    { key: 'zones', schema: 'ZoneData', idPrefix: '' },
    { key: 'loot_tables', schema: 'LootData', idPrefix: '' },
  ],
  files: {
    'zones/zn_haven.tres': 'script_class="ZoneData"\nid = "zn_haven"\nname = "Haven"\n',
    'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\nbook_id = "book_npc_smith_epic"\n',
    'loot_tables/loot_a.tres': '[resource]\nscript_class="LootData"\nid = "loot_a"\nentries = [{\n"item_id": "zn_haven"\n}]\n',
  },
  edges: [
    { family: 'npcs', field: 'home_zone_id', target: 'zones', kind: 'ref' },
    { family: 'loot_tables', field: 'entries.item_id', target: 'zones', kind: 'nested' },
    { family: 'npcs', field: 'book_id', kind: 'virtual', pattern: 'book_<npc>_<tier>', required: true },
  ],
  virtualFamilies: { npc: 'npcs' },
};

const cases = [
  { id: 'clean', base: true, expect: { violations: [] } },
  {
    id: 'undeclared-edge',
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\nrival_id = "npc_other"\n' },
    expect: { codes: ['undeclared-edge'] },
  },
  {
    id: 'dangling-ref',
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_missing"\n' },
    expect: { codes: ['dangling-ref'] },
  },
  {
    id: 'literal-ok',
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\nexternal_id = "X-99"\n' },
    extraEdges: [{ family: 'npcs', field: 'external_id', target: 'zones', kind: 'literal' }],
    expect: { violations: [] },
  },
  {
    id: 'literal-keeps-teeth',
    // a PascalCase class name in an _id field is NOT an id; declaring it
    // `literal` is the honest call, and it never resolves (SPEC section 5).
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\nservice_id = "BlacksmithService"\n' },
    extraEdges: [{ family: 'npcs', field: 'service_id', target: 'zones', kind: 'literal' }],
    expect: { violations: [] },
  },
  {
    id: 'schema-mismatch',
    add: { 'npcs/npc_smith.tres': 'script_class="WrongData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\n' },
    expect: { codes: ['schema-mismatch'] },
  },
  {
    id: 'undeclared-family',
    add: { 'quests/qst_one.tres': 'script_class="QuestData"\nid = "qst_one"\n' },
    expect: { codes: ['undeclared-family'] },
  },
  {
    id: 'cycle',
    add: {
      'npcs/npc_a.tres': 'script_class="NpcData"\nid = "npc_a"\nhome_zone_id = "zn_haven"\nrival_id = "npc_b"\n',
      'npcs/npc_b.tres': 'script_class="NpcData"\nid = "npc_b"\nhome_zone_id = "zn_haven"\nrival_id = "npc_a"\n',
    },
    extraEdges: [{ family: 'npcs', field: 'rival_id', target: 'npcs', kind: 'ref' }],
    expect: { codes: ['cycle'] },
  },
  {
    id: 'required-false-warns',
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_missing"\n' },
    overrideEdges: [
      { family: 'npcs', field: 'home_zone_id', target: 'zones', kind: 'ref', required: false },
      { family: 'loot_tables', field: 'entries.item_id', target: 'zones', kind: 'nested' },
    ],
    expect: { violations: [], codes: [] },
  },
  {
    id: 'duplicate-edge',
    extraEdges: [{ family: 'npcs', field: 'home_zone_id', target: 'zones', kind: 'ref' }],
    expect: { declErrors: ['duplicate-edge'] },
  },
  {
    id: 'nested-ref-ok',
    // a nested edge resolves: entries[].item_id -> a real zone
    expect: { violations: [] },
  },
  {
    id: 'nested-ref-dangling',
    // the SAME nested path, but the inner id does not resolve. Before the parser
    // stopped flattening dicts, this could never fire.
    add: { 'loot_tables/loot_a.tres': '[resource]\nscript_class="LootData"\nid = "loot_a"\nentries = [{\n"item_id": "zn_missing"\n}]\n' },
    expect: { codes: ['dangling-ref'] },
  },
  {
    id: 'nested-ref-undeclared',
    // a nested _id key no edge declares
    add: { 'loot_tables/loot_a.tres': '[resource]\nscript_class="LootData"\nid = "loot_a"\nentries = [{\n"item_id": "zn_haven",\n"rival_id": "zn_haven"\n}]\n' },
    expect: { codes: ['undeclared-edge'] },
  },
  {
    id: 'virtual-ref-ok',
    // a virtual edge: pattern matches, the <npc> stem resolves -> no violation
    expect: { violations: [] },
  },
  {
    id: 'virtual-ref-dangling-stem',
    // the pattern matches but the <npc> stem names no record -> dangling-ref.
    // The old lint returned true unconditionally here, so this could never fire.
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\nbook_id = "book_npc_ghost_epic"\n' },
    expect: { codes: ['dangling-ref'] },
  },
  {
    id: 'virtual-no-pattern',
    // a virtual edge with no pattern is a silent skip -> unknown-rule
    overrideEdges: [
      { family: 'npcs', field: 'home_zone_id', target: 'zones', kind: 'ref' },
      { family: 'loot_tables', field: 'entries.item_id', target: 'zones', kind: 'nested' },
      { family: 'npcs', field: 'book_id', kind: 'virtual' },
    ],
    expect: { codes: ['unknown-rule'] },
  },
  {
    id: 'nested-spec-array-form',
    // The spec writes a nested path as `entries[].item_id`; the tree stores
    // `entries.item_id`. A declaration written from the SPEC must work - a
    // silently-skipped edge is the failure this standard exists to end.
    overrideEdges: [
      { family: 'npcs', field: 'home_zone_id', target: 'zones', kind: 'ref' },
      { family: 'loot_tables', field: 'entries[].item_id', target: 'zones', kind: 'nested' },
      { family: 'npcs', field: 'book_id', kind: 'virtual', pattern: 'book_<npc>_<tier>' },
    ],
    add: { 'loot_tables/loot_a.tres': '[resource]\nscript_class="LootData"\nid = "loot_a"\nentries = [{\n"item_id": "zn_missing"\n}]\n' },
    expect: { codes: ['dangling-ref'] },
  },
  {
    id: 'baseline-unknown-key',
    // A key the matcher does not read (e.g. a typo'd `match`) would be ignored,
    // silently widening the row to a catch-all. It MUST be refused instead.
    baselines: [{ code: 'dangling-ref', match: 'npcs/*.tres', reason: 'typo key', expires: '2027-01-01' }],
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_missing"\n' },
    expect: { codes: ['unknown-rule'] },
  },
  {
    id: 'baseline-glob-scoped',
    // A glob baseline excuses only the records it names - a dangling ref on a
    // record OUTSIDE the glob still refuses. This is the teeth: no catch-all.
    baselines: [{ code: 'dangling-ref', record: 'zones/*.tres', field: 'world_id', reason: 'ack', expires: '2027-01-01' }],
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_missing"\n' },
    expect: { codes: ['dangling-ref'], warnCodes: ['baseline-unmatched'] },
  },
  {
    id: 'name-dir-mismatch',
    // a declared family that matches no directory in the tree
    families: [
      { key: 'npcs', schema: 'NpcData', idPrefix: '' },
      { key: 'zones', schema: 'ZoneData', idPrefix: '' },
      { key: 'loot_tables', schema: 'LootData', idPrefix: '' },
      { key: 'ghosts', schema: 'GhostData', idPrefix: '' },
    ],
    expect: { codes: ['name-dir-mismatch'] },
  },
  {
    id: 'filename-id-mismatch',
    // the record DECLARES an id that disagrees with its filename stem
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_wrong"\nhome_zone_id = "zn_haven"\n' },
    expect: { codes: ['filename-id-mismatch'] },
  },
  {
    id: 'unknown-rule',
    // a baseline naming a code the vocabulary does not carry
    baselines: [{ code: 'not-a-real-code', record: 'x', reason: 'should be refused' }],
    expect: { codes: ['unknown-rule'] },
  },
  {
    id: 'baseline-expired',
    // a baseline whose expiry has passed stops excusing: the refusal returns
    add: { 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_missing"\n' },
    baselines: [{ code: 'dangling-ref', field: 'home_zone_id', reason: 'known gap', expires: '2000-01-01' }],
    expect: { codes: ['baseline-expired', 'dangling-ref'] },
  },
  {
    id: 'baseline-unmatched',
    // a baseline that matches nothing is reported so it can be retired
    baselines: [{ code: 'dangling-ref', record: 'npcs/npc_ghost.tres', reason: 'stale excuse' }],
    expect: { codes: [], warnCodes: ['baseline-unmatched'] },
  },
  {
    id: 'not-a-tree-root',
    // SPEC section 1: the root must be the directory whose children are FAMILIES.
    // Here one family spans two directories and two schemas - the shape a project
    // root above the data dir produces, where no edge can resolve. It read as a
    // clean 0-edge tree and exited 0 before this rule existed.
    files: {
      'data/zones/zn_a.tres': 'script_class="ZoneData"\nid = "zn_a"\n',
      'data/npcs/npc_a.tres': 'script_class="NpcData"\nid = "npc_a"\n',
    },
    families: [{ key: 'data', idPrefix: '' }],
    overrideEdges: [],
    expect: { codes: ['not-a-tree-root'] },
  },
  {
    id: 'empty-tree',
    // a root with no records cannot produce a meaningful verdict; a clean pass over
    // nothing is the vacuous shape a silent failure takes.
    files: {},
    families: [],
    overrideEdges: [],
    expect: { codes: ['empty-tree'] },
  },
];

/** Read every file under a dir into a { relPath: contents } map. */
function walkFiles(dir, base = dir, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else out[relative(base, full).split('\\').join('/')] = readFileSync(full, 'utf8');
  }
  return out;
}

/** Materialize a case into a temp dir; return { dir, declPath }. */
function materialize(c) {
  const dir = mkdtempSync(join(tmpdir(), 'tresridge-'));
  const base = c.base ? CLEAN : CLEAN;
  // `files` REPLACES the base file set (the empty-tree case needs a genuinely empty
  // root, which merging onto CLEAN could never produce).
  const files = c.files ? { ...c.files, ...(c.add || {}) } : { ...base.files, ...(c.add || {}) };
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  let edges = [...base.edges];
  if (c.extraEdges) edges = edges.concat(c.extraEdges);
  if (c.overrideEdges) edges = c.overrideEdges;
  const families = c.families || base.families;
  const decl = { schemaVersion: 1, families, edges };
    if (CLEAN.virtualFamilies) decl.virtualFamilies = CLEAN.virtualFamilies;
  if (c.baselines) decl.baselines = c.baselines;
  if (c.schemaVersion !== undefined) decl.schemaVersion = c.schemaVersion;
  const declPath = join(dir, 'relations.json');
  writeFileSync(declPath, JSON.stringify(decl, null, 2));
  return { dir, declPath, decl };
}

const rows = [];
let dishonest = 0;

for (const c of cases) {
  const { dir, declPath, decl } = materialize(c);
  let observed;
  try {
    const tree = readTree(dir);
    const result = lint(tree, decl);
    // declaration-level errors are surfaced by the CLI; the battery observes
    // them through the same validator the CLI uses.
    const { validateDeclaration } = await import('../src/lint.mjs');
    const declErrors = validateDeclaration(decl);
    observed = {
      violations: result.violations.map((v) => v.code).sort(),
      warnings: result.warnings.map((w) => w.code).sort(),
      declErrors: declErrors.map((e) => e.split(':')[0].trim()),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const expect = c.expect || {};
  const problems = [];
  if (expect.violations !== undefined && JSON.stringify(expect.violations) !== JSON.stringify(observed.violations)) {
    problems.push(`violations: expected ${JSON.stringify(expect.violations)}, observed ${JSON.stringify(observed.violations)}`);
  }
  if (expect.codes !== undefined) {
    const want = [...expect.codes].sort();
    if (JSON.stringify(want) !== JSON.stringify(observed.violations)) {
      problems.push(`codes: expected ${JSON.stringify(want)}, observed ${JSON.stringify(observed.violations)}`);
    }
  }
  if (expect.warnCodes !== undefined) {
    const want = [...expect.warnCodes].sort();
    if (JSON.stringify(want) !== JSON.stringify(observed.warnings)) {
      problems.push(`warnCodes: expected ${JSON.stringify(want)}, observed ${JSON.stringify(observed.warnings)}`);
    }
  }
  if (expect.declErrors !== undefined) {
    const want = [...expect.declErrors].sort();
    if (JSON.stringify(want) !== JSON.stringify(observed.declErrors)) {
      problems.push(`declErrors: expected ${JSON.stringify(want)}, observed ${JSON.stringify(observed.declErrors)}`);
    }
  }

  const ok = problems.length === 0;
  if (!ok) dishonest++;
  rows.push({ id: c.id, observed, expected: expect, ok, problems });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${c.id}${ok ? '' : '  <- ' + problems.join('; ')}`);
}

if (dishonest) {
  console.error(`\n  REFUSED: ${dishonest} row(s) disagree with expectation - the matrix would lie.`);
  process.exit(1);
}

// Write the column + the portable battery files.
const column = {
  schema: 1,
  what: 'The tresridge column of the shared refusal matrix. Every verdict is OBSERVED from the actual lint run over materialized bytes, never hand-derived. Regenerate with `npm run matrix:gen`.',
  generator: 'scripts/gen-refusal-matrix.mjs',
  rows: rows.map((r) => ({ id: r.id, observed: r.observed, status: 'agree' })),
};

const outDir = join(ROOT, 'labs');
const batteryDir = join(outDir, 'refusal-battery');
mkdirSync(batteryDir, { recursive: true });

const serialize = (o) => JSON.stringify(o, null, 2) + '\n';
const files = { 'refusal-matrix.tresridge.json': serialize(column) };
for (const c of cases) {
  const clean = { id: c.id, base: !!c.base, add: c.add || {}, extraEdges: c.extraEdges || [], overrideEdges: c.overrideEdges || [], expect: c.expect || {} };
  files[`refusal-battery/${c.id}.json`] = serialize(clean);
}

// Also emit the on-disk conformance-case form from the SAME definitions, so
// the flat battery and the tree form can never drift apart.
const casesDir = join(ROOT, 'conformance', 'cases');
for (const c of cases) {
  const { dir } = materialize(c);
  try {
    for (const [rel, body] of Object.entries(walkFiles(dir))) {
      files[`../conformance/cases/${c.id}/${rel}`] = body;
    }
    const tree = readTree(dir);
    const { validateDeclaration } = await import('../src/lint.mjs');
    const result = lint(tree, JSON.parse(readFileSync(join(dir, 'relations.json'), 'utf8')));
    files[`../conformance/cases/${c.id}/expected.json`] = serialize({
      violations: result.violations.map((v) => v.code).sort(),
      warnings: result.warnings.map((w) => w.code).sort(),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let drift = 0;
for (const [rel, body] of Object.entries(files)) {
  const full = join(outDir, rel);
  if (CHECK) {
    const cur = existsSync(full) ? readFileSync(full, 'utf8') : null;
    if (cur !== body) { console.error(`  DRIFT: ${rel}`); drift++; }
  } else {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}
if (CHECK && drift) { console.error(`\n  REFUSED: ${drift} file(s) drifted - run \`npm run matrix:gen\`.`); process.exit(1); }

console.log(`\n  ${rows.length} rows honest${CHECK ? ' (checked)' : ', column + battery written'}.`);
