// The CLI battery: exercise `bin/cli.mjs` as a program, not the library behind it.
//
// Every other test in this repo imports `src/` and calls it directly. That is why a
// whole class of defect survived: the CLI is where the tree root is resolved, the
// declaration is found, the exit code is decided, and the arguments are parsed - and
// none of it was ever run. These cases spawn the real binary and assert on stdout,
// stderr, and the exit code, because the exit code IS the contract (SPEC section 8).
//
// Nothing here is mocked. Every case materializes real bytes in a temp dir and runs
// the real CLI over them.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateHeap } from '../src/tres.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.mjs');

const fails = [];
let checks = 0;

/** Run the CLI. Returns { code, out, err } and never throws on a non-zero exit. */
function cli(args, cwd = ROOT, env = process.env) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

/** Materialize a { relPath: body } map into a temp dir. */
function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'tresridge-cli-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const DECL = JSON.stringify({
  schemaVersion: 1,
  families: [
    { key: 'npcs', schema: 'NpcData', idPrefix: '' },
    { key: 'zones', schema: 'ZoneData', idPrefix: '' },
  ],
  edges: [{ family: 'npcs', field: 'home_zone_id', target: 'zones', kind: 'ref', required: true }],
}, null, 2) + '\n';

const CLEAN = {
  'relations.json': DECL,
  'zones/zn_haven.tres': 'script_class="ZoneData"\nid = "zn_haven"\n',
  'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\n',
};

/** Assert one observable property of a run. */
function check(label, cond, detail = '') {
  checks++;
  if (cond) return;
  fails.push(`${label}${detail ? `  <- ${detail}` : ''}`);
  console.log(`  FAIL  ${label}${detail ? `  <- ${detail}` : ''}`);
}

/** Assert an exit code. */
function expectCode(label, got, want) {
  check(label, got.code === want, `exit ${got.code}, want ${want} (err: ${got.err.trim().split('\n')[0] || '-'})`);
}

const dirs = [];
const make = (files) => { const d = tree(files); dirs.push(d); return d; };

try {
  // -- the clean path ---------------------------------------------------------
  {
    const d = make(CLEAN);
    const r = cli(['lint', d]);
    expectCode('lint clean exits 0', r, 0);
    check('lint clean reports the corpus', /2 families, 2 records, 1 edges/.test(r.out), r.out.trim());
    check('lint clean reports zero violations', /0 violation\(s\)/.test(r.out), r.out.trim());
  }

  // -- exit 1: a real violation ----------------------------------------------
  {
    const d = make({ ...CLEAN, 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_missing"\n' });
    const r = cli(['lint', d]);
    expectCode('dangling ref exits 1', r, 1);
    check('dangling ref names the code', /dangling-ref/.test(r.out), r.out.trim());
  }

  // -- a reference value that is not id-shaped is judged, not skipped (#20) ---
  // The reader matched only id characters INSIDE the quotes, so `"O'Brien"` matched
  // nothing: the field vanished, the edge count fell with it, and the run looked clean.
  for (const value of ["O'Brien_target", "Rook's Own", 'a/b', 'has space']) {
    const d = make({ ...CLEAN, 'npcs/npc_smith.tres': `script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "${value}"\n` });
    const r = cli(['lint', d]);
    expectCode(`a non-id value ${JSON.stringify(value)} is refused`, r, 1);
    check(`the refusal names dangling-ref for ${JSON.stringify(value)}`, /dangling-ref/.test(r.out), r.out.trim());
    check(`the refusal says the value is not id-shaped for ${JSON.stringify(value)}`, /not id-shaped/.test(r.out), r.out.trim());
    // The count must include the value that was judged, or the summary reports a
    // smaller tree than the one that was linted.
    check(`the edge count includes ${JSON.stringify(value)}`, /1 edges/.test(r.out), r.out.trim());
  }

  // An EMPTY string is "no reference", not a dangling one: Godot writes it.
  {
    const d = make({ ...CLEAN, 'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = ""\n' });
    expectCode('an empty reference value is not a dangle', cli(['lint', d]), 0);
  }

  // `literal` stays the honesty kind: a non-id value there is the POINT, never a
  // refusal (SPEC section 5). This guards the #20 fix from breaking it.
  {
    const decl = JSON.stringify({
      schemaVersion: 1,
      families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }],
      edges: [{ family: 'npcs', field: 'external_id', kind: 'literal' }],
    }, null, 2) + '\n';
    const d = make({
      'relations.json': decl,
      'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nexternal_id = "X-99"\n',
    });
    expectCode('a literal field holding a non-id is clean', cli(['lint', d]), 0);
  }

  // -- graph makes a non-*_id reference visible (#22) -------------------------
  // `graph` only looked at fields ending _id/_ids, so a host naming its references
  // `edges[].to` got "0 edges, 0 residue" over a tree full of references.
  {
    const d = make({
      'species/sp_1.tres': 'script_class="SpeciesData"\nid = "sp_1"\n',
      'fallacies/fal_1.tres': 'script_class="FallacyData"\nid = "fal_1"\nedges = [{\n"to": "sp_1"\n}]\n',
    });
    const r = cli(['graph', d, '--json']);
    expectCode('graph runs on a non-*_id reference tree', r, 0);
    const parsed = JSON.parse(r.out);
    check('the naming rule still infers no edge from `to`', parsed.declaration.edges.length === 0,
      `${parsed.declaration.edges.length} inferred`);
    check('the reference is reported as probable residue',
      (parsed.residue.probable || []).length === 1, JSON.stringify(parsed.residue.probable));
    check('the probable row names the field', parsed.residue.probable?.[0]?.field === 'edges.to',
      JSON.stringify(parsed.residue.probable?.[0]));
    check('the probable row names the target family', parsed.residue.probable?.[0]?.targets?.includes('species'),
      JSON.stringify(parsed.residue.probable?.[0]?.targets));
    check('the probable row counts its values', parsed.residue.probable?.[0]?.count === 1,
      JSON.stringify(parsed.residue.probable?.[0]?.count));

    // The text output must SAY it: a JSON-only field is still a blank page to a host
    // running the on-ramp by hand.
    const t = cli(['graph', d]);
    check('the text output reports probable refs', /probable: 1 field/.test(t.out), t.out.trim());
    check('the text output names the field', /fallacies\.edges\.to/.test(t.out), t.out.trim());
    check('the text output says how to declare it', /literal/.test(t.out), t.out.trim());
  }

  // A TOP-LEVEL `id` is record identity, never a reference. On the reference
  // deployment this produced 6 false positives (achievements.id -> titles, etc.),
  // because two families legitimately hold the same id. A NESTED `.id` is a real
  // reference and must survive this filter.
  {
    const d = make({
      'species/sp_1.tres': 'script_class="SpeciesData"\nid = "shared"\n',
      'zones/shared.tres': 'script_class="ZoneData"\nid = "shared"\nrewards = [{\n"id": "shared"\n}]\n',
    });
    const r = cli(['graph', d, '--json']);
    const parsed = JSON.parse(r.out);
    const prob = parsed.residue.probable || [];
    check('a top-level id shared across families is not probable residue',
      !prob.some((x) => x.field === 'id'), JSON.stringify(prob.map((x) => x.field)));
    check('a nested .id is still reported as probable',
      prob.some((x) => x.field === 'rewards.id'), JSON.stringify(prob.map((x) => x.field)));
  }

  // The evidence must be auditable: `distinct` counts DISTINCT values, so a ratio
  // above 1.00 is impossible. An occurrence count on one side once produced 2.00.
  {
    const d = make({
      'species/sp_1.tres': 'script_class="SpeciesData"\nid = "sp_1"\n',
      'fallacies/fal_1.tres': 'script_class="FallacyData"\nid = "fal_1"\nrels = [{\n"to": "sp_1"\n}, {\n"to": "sp_1"\n}]\n',
    });
    const parsed = JSON.parse(cli(['graph', d, '--json']).out);
    const row = (parsed.residue.probable || []).find((x) => x.field === 'rels.to');
    check('a repeated value counts once in distinct', row?.distinct === 1, JSON.stringify(row));
    check('the ratio never exceeds 1.00', row ? row.ratio <= 1 : false, JSON.stringify(row));
  }

  // A field whose values are NOT ids from another family stays silent: widened
  // residue is for references, not for every string field.
  {
    const d = make({
      'species/sp_1.tres': 'script_class="SpeciesData"\nid = "sp_1"\nname = "Elf"\n',
      'fallacies/fal_1.tres': 'script_class="FallacyData"\nid = "fal_1"\nnote = "unrelated text"\n',
    });
    const r = cli(['graph', d, '--json']);
    const parsed = JSON.parse(r.out);
    check('a non-reference string field is not probable residue',
      (parsed.residue.probable || []).length === 0, JSON.stringify(parsed.residue.probable));
  }


  // -- exit 2: usage ---------------------------------------------------------
  expectCode('no arguments is a usage error', cli([]), 2);
  expectCode('unknown verb is a usage error', cli(['bogus', '/tmp']), 2);
  expectCode('missing tree is a usage error', cli(['lint', '/nope/not/here']), 2);

  // --version is a promise the release ladder depends on ---------------------
  // verify-release installs the published tarball and asserts
  // `tresridge --version` answers the packaged version. With no handler the CLI
  // printed USAGE and exited 2, so the ladder could never pass on a real cut.
  {
    const r = cli(['--version']);
    const want = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    expectCode('--version exits 0', r, 0);
    check('--version prints the packaged version', r.out.trim() === want, `${r.out.trim()} != ${want}`);
    expectCode('-v exits 0', cli(['-v']), 0);
  }

  // -- the contract root (SPEC section 1) ------------------------------------
  // The defect this file exists for: a root ABOVE the tree root collapsed every
  // record into one family, inferred 0 edges, and exited 0 - a silent pass.
  {
    const d = make({
      'game/data/relations.json': DECL,
      'game/data/zones/zn_haven.tres': 'script_class="ZoneData"\nid = "zn_haven"\n',
      'game/data/npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\n',
    });
    const above = cli(['graph', d]);
    expectCode('root above the tree root is refused', above, 2);
    check('root above names not-a-tree-root', /not-a-tree-root/.test(above.err), above.err.trim());
    check('root above hints the real root', /try: .*game[\/\\]data/.test(above.err), above.err.trim());

    // ...and the correct root works, so the refusal is not a blanket denial.
    const right = cli(['graph', join(d, 'game', 'data')]);
    expectCode('the tree root itself is accepted', right, 0);
    check('the tree root infers the edge', /1 edges inferred/.test(right.out), right.out.trim());
  }

  // A root BELOW the tree root (a family directory) turns records into families.
  {
    const d = make(CLEAN);
    const r = cli(['graph', join(d, 'npcs')]);
    expectCode('a family directory is refused as a root', r, 2);
    check('family-dir root names not-a-tree-root', /not-a-tree-root/.test(r.err), r.err.trim());
  }

  // An empty root must not read as a clean pass.
  {
    const d = make({ 'notes.txt': 'no records here\n' });
    const r = cli(['graph', d]);
    expectCode('an empty tree is refused', r, 2);
    check('empty tree names empty-tree', /empty-tree/.test(r.err), r.err.trim());
  }

  // A single-family tree is LEGAL and must not be caught by the root guard.
  {
    const d = make({
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }], edges: [] }, null, 2) + '\n',
      'npcs/a.tres': 'script_class="NpcData"\nid = "a"\n',
      'npcs/b.tres': 'script_class="NpcData"\nid = "b"\n',
    });
    const r = cli(['lint', d]);
    expectCode('a legit single-family tree is accepted', r, 0);
  }

  // A mixed family (many schemas in ONE directory) is legal (SPEC section 2).
  {
    const d = make({
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'balance', idPrefix: '' }], edges: [] }, null, 2) + '\n',
      'balance/a.tres': 'script_class="AlphaData"\nid = "a"\n',
      'balance/b.tres': 'script_class="BetaData"\nid = "b"\n',
    });
    const r = cli(['lint', d]);
    expectCode('a mixed family in one directory is accepted', r, 0);
  }

  // -- declaration discovery -------------------------------------------------
  // The declaration is the TREE's artifact, so a run from elsewhere must find it.
  {
    const d = make(CLEAN);
    const r = cli(['doctor', d], tmpdir());
    expectCode('doctor finds <tree>/relations.json from another cwd', r, 0);
    check('doctor reports the declared edge count', /declared edges:\s+1/.test(r.out), r.out.trim());
  }
  // The tree's own declaration WINS over one sitting in the cwd. This is the whole
  // point of the rule: a stale ./relations.json must not silently judge another tree.
  {
    const d = make(CLEAN);
    const elsewhere = make({ 'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }, { key: 'zones', schema: 'ZoneData', idPrefix: '' }], edges: [] }, null, 2) + '\n' });
    const r = cli(['doctor', d], elsewhere);
    expectCode('the tree declaration wins over the cwd one', r, 0);
    check('the tree declaration is the one read', /declared edges:\s+1/.test(r.out), r.out.trim());
  }
  // An explicit --decl still wins, and is resolved against the cwd.
  {
    const d = make(CLEAN);
    const alt = make({ ...CLEAN, 'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }, { key: 'zones', schema: 'ZoneData', idPrefix: '' }], edges: [] }, null, 2) + '\n' });
    const r = cli(['doctor', d, '--decl', join(alt, 'relations.json')]);
    // The alternate declaration declares no edge, so the tree's home_zone_id is
    // undeclared and doctor reports a violation - which proves the alternate was read.
    expectCode('explicit --decl is honoured', r, 1);
    check('explicit --decl reports its own edge count', /declared edges:\s+0/.test(r.out), r.out.trim());
  }

  // -- --json parity ---------------------------------------------------------
  {
    const d = make(CLEAN);
    const r = cli(['doctor', d, '--json']);
    expectCode('doctor --json exits 0', r, 0);
    let parsed = null;
    try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
    check('doctor --json emits parseable JSON', parsed !== null, r.out.slice(0, 80));
    check('doctor --json carries the summary', parsed && parsed.families === 2 && parsed.records === 2 && parsed.edgesInferred === 1, JSON.stringify(parsed));
    // The documented shape (SPEC section 8) is a contract, so assert it literally.
    check('doctor --json matches the documented shape',
      parsed && parsed.needsDeclaring === 0 && parsed.declaration && parsed.declaration.edges === 1
        && typeof parsed.declaration.path === 'string' && Array.isArray(parsed.violations) && Array.isArray(parsed.warnings),
      JSON.stringify(parsed));
  }

  // -- doctor refuses rather than summarising an unjudged tree ---------------
  // `doctor` is the first verb a host runs. Exiting 0 over a tree it never judged
  // is the silent pass the whole contract exists to stop.
  {
    const d = make({ 'npcs/a.tres': 'script_class="NpcData"\nid = "a"\nzone_id = "zn_x"\n' });
    const r = cli(['doctor', d], tmpdir());
    expectCode('doctor without a declaration exits 2, not 0', r, 2);
    check('doctor without a declaration names the missing file', /declaration not found/.test(r.err), r.err.trim() || r.out.trim());
    check('doctor without a declaration reports no verdict', !/violations:/.test(r.out), r.out.trim());
  }

  // A malformed declaration is a named DECL refusal, not a raw TypeError.
  {
    const d = make(CLEAN);
    writeFileSync(join(d, 'relations.json'), JSON.stringify({ schemaVersion: 1, families: 'not-an-array', edges: [] }));
    const r = cli(['doctor', d]);
    expectCode('doctor with a malformed declaration exits 1', r, 1);
    check('doctor reports malformed declaration as DECL', /DECL /.test(r.err), r.err.trim() || r.out.trim());
    check('doctor does not leak a raw TypeError', !/is not a function|Cannot read/.test(r.err + r.out), (r.err + r.out).trim());
  }

  // -- graph --against -------------------------------------------------------
  {
    const d = make(CLEAN);
    expectCode('graph --against a matching declaration exits 0', cli(['graph', d, '--against', join(d, 'relations.json')]), 0);
    // `zone_id` resolves to the `zones` family, so inference emits it as a NEW edge
    // that the committed declaration does not name - real drift, not residue.
    const drifted = make({
      ...CLEAN,
      'npcs/npc_smith.tres': 'script_class="NpcData"\nid = "npc_smith"\nhome_zone_id = "zn_haven"\nzone_id = "zn_haven"\n',
    });
    const r = cli(['graph', drifted, '--against', join(drifted, 'relations.json')]);
    expectCode('graph --against reports drift as exit 1', r, 1);
    check('graph --against names the added edge', /zone_id/.test(r.out), r.out.trim());
    expectCode('graph --against a missing file is a usage error', cli(['graph', d, '--against', join(d, 'nope.json')]), 2);
  }

  // -- --rules: host rules ADD findings, at any scope -------------------------
  {
    const d = make(CLEAN);
    const host = join(d, 'host.mjs');
    writeFileSync(host, `export const rules = [
  { code: 'undeclared-edge', severity: 'violation', scope: 'declaration',
    run() { return [{ code: 'undeclared-edge', record: 'HOST', detail: 'declaration-scope host rule ran' }]; } },
];
`);
    const r = cli(['lint', d, '--rules', host]);
    expectCode('a declaration-scope host rule fires', r, 1);
    check('the host finding is reported', /HOST/.test(r.out), r.out.trim());
  }
  // A host rule may not invent a code.
  {
    const d = make(CLEAN);
    const host = join(d, 'bad.mjs');
    writeFileSync(host, `export const rules = [{ code: 'invented-code', run() { return []; } }];\n`);
    const r = cli(['lint', d, '--rules', host]);
    expectCode('an invented host code is refused', r, 1);
    check('the invented code is named', /invented-code/.test(r.out), r.out.trim());
  }

  // -- rules verb needs no tree ----------------------------------------------
  {
    const r = cli(['rules']);
    expectCode('rules exits 0', r, 0);
    // The count is DERIVED from the vocabulary, never a constant: a literal here goes
    // stale the moment a refusal is added, which is the drift this repo's own gates
    // exist to refuse. (It read `13` and failed on the 15th code.)
    const vocabCount = JSON.parse(readFileSync(join(ROOT, 'spec', 'refusals.json'), 'utf8')).codes.length;
    check('rules lists the vocabulary', new RegExp(`${vocabCount} refusal codes`).test(r.out), r.out.trim());
    const j = cli(['rules', '--json']);
    expectCode('rules --json exits 0', j, 0);
    const parsed = JSON.parse(j.out);
    check('rules --json emits every code in the vocabulary', parsed.count === vocabCount && parsed.codes.length === vocabCount, j.out.trim().slice(0, 200));
  }

  // -- unreadable bytes are refused, never read -------------------------------
  // A conflict-marked file carries BOTH sides of a field; reading either is a guess.
  // Before `unparseable-record` it linted clean and the loader took the last side.
  {
    const d = make({
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }], edges: [] }, null, 2) + '\n',
      'npcs/npc_a.tres': 'script_class="NpcData"\nid = "npc_a"\n',
      'npcs/npc_b.tres': '<<<<<<< HEAD\nscript_class="NpcData"\nid = "npc_b"\n=======\nscript_class="NpcData"\nid = "npc_b"\n>>>>>>> branch\n',
    });
    const r = cli(['lint', d]);
    expectCode('a conflict-marked record exits 1', r, 1);
    check('the refusal names the file and the cause', /unparseable-record\s+npcs\/npc_b\.tres.*merge conflict/.test(r.out), r.out.trim());
    check('the readable sibling is NOT blamed', !/npc_a\.tres/.test(r.out), r.out.trim());
  }
  {
    const d = make({
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }], edges: [] }, null, 2) + '\n',
      'npcs/npc_a.tres': 'this is not a tres file\n',
    });
    const r = cli(['lint', d]);
    expectCode('a non-resource .tres exits 1', r, 1);
    check('the refusal says why it could not be read', /unparseable-record.*no \[resource\] section/.test(r.out), r.out.trim());
  }

  // -- one id means one record ------------------------------------------------
  // The loader would pick one body and leave the other unreachable, so the tree is
  // refused. Nested so both filenames stay legal - the ID collides, not the name.
  {
    const d = make({
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }], edges: [] }, null, 2) + '\n',
      'npcs/npc_a.tres': 'script_class="NpcData"\nid = "npc_a"\n',
      'npcs/sub/npc_a.tres': 'script_class="NpcData"\nid = "npc_a"\n',
    });
    const r = cli(['lint', d]);
    expectCode('a duplicate record id exits 1', r, 1);
    check('the refusal names the first declaration', /duplicate-record-id.*already declared by npcs\/npc_a\.tres/.test(r.out), r.out.trim());
  }

  // -- the id-less exemption is real, not a docstring ------------------------
  // SPEC section 2 keys an id-less record by PATH. Two of them share a stem and are
  // still two records; a path-blind key would silently shadow one.
  {
    const d = make({
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'roots', schema: 'RootData', idPrefix: '' }], edges: [] }, null, 2) + '\n',
      'roots/a/environment.tres': 'script_class="RootData"\nname = "A"\n',
      'roots/b/environment.tres': 'script_class="RootData"\nname = "B"\n',
    });
    const r = cli(['lint', d]);
    expectCode('two id-less records sharing a stem are legal', r, 0);
    check('both are counted as records', /1 families, 2 records/.test(r.out), r.out.trim());
  }

  // -- residue is counted, not a constant ------------------------------------
  // `count` was always 1 because the dedupe ran before the increment, so the list
  // could not say how much work a field was.
  {
    const d = make({
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: '' }], edges: [] }, null, 2) + '\n',
      'npcs/a.tres': 'script_class="NpcData"\nid = "a"\nmystery_id = "x"\n',
      'npcs/b.tres': 'script_class="NpcData"\nid = "b"\nmystery_id = "y"\n',
      'npcs/c.tres': 'script_class="NpcData"\nid = "c"\nmystery_id = "z"\n',
    });
    const r = cli(['graph', d, '--json']);
    let parsed = null;
    try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
    const row = parsed?.residue?.undeclared?.find((u) => u.field === 'mystery_id');
    check('residue counts every record carrying the field', row && row.count === 3, JSON.stringify(parsed?.residue?.undeclared));

    // -- output is capped per code, and the cap cannot hide a KIND of problem ------
    // A 10k-record tree printed 5,883 identical `dangling-ref` lines and scrolled the
    // one refusal that mattered off the screen. The cap is per code, so a rare refusal
    // always prints in full even when a common one is truncated.
    //
    // The rare code here is `cycle`, chosen because it runs AFTER `dangling-ref` in the
    // rule order. A naive global cap would print the first 20 rows - all dangling - and
    // drop the cycle entirely, which is exactly the silent pass this guards.
    {
      const decl = JSON.stringify({
        schemaVersion: 1,
        families: [
          { key: 'npcs', schema: 'NpcData', idPrefix: '' },
          { key: 'zones', schema: 'ZoneData', idPrefix: '' },
        ],
        edges: [
          { family: 'npcs', field: 'home_zone_id', target: 'zones', kind: 'ref', required: true },
          // required: true because the cycle rule only follows required refs - an
          // optional link is a graph hint, not a structural commitment.
          { family: 'npcs', field: 'rival_id', target: 'npcs', kind: 'ref', required: true },
        ],
      }, null, 2) + '\n';
      const files = { 'relations.json': decl, 'zones/zn_haven.tres': 'script_class="ZoneData"\nid = "zn_haven"\n' };
      for (let i = 0; i < 30; i++) files[`npcs/npc_${i}.tres`] = `script_class="NpcData"\nid = "npc_${i}"\nhome_zone_id = "zn_gone"\n`;
      files['npcs/npc_cyc_a.tres'] = 'script_class="NpcData"\nid = "npc_cyc_a"\nhome_zone_id = "zn_haven"\nrival_id = "npc_cyc_b"\n';
      files['npcs/npc_cyc_b.tres'] = 'script_class="NpcData"\nid = "npc_cyc_b"\nhome_zone_id = "zn_haven"\nrival_id = "npc_cyc_a"\n';
      const d = make(files);

      const capped = cli(['lint', d]);
      expectCode('a capped run still exits 1', capped, 1);
      check('the cap prints the 20 it allows', (capped.out.match(/FAIL  dangling-ref/g) || []).length === 20,
        `saw ${(capped.out.match(/FAIL  dangling-ref/g) || []).length}`);
      check('the cap states how many it withheld', /10 more dangling-ref/.test(capped.out),
        capped.out.split('\n').find((l) => /more dangling-ref/.test(l)) || 'no line');
      check('the true count is still reported', /31 violation\(s\)/.test(capped.out), capped.out.trim().split('\n').pop());
      check('a rare code emitted AFTER the common one is not truncated away', /FAIL  cycle/.test(capped.out),
        'cycle missing - the cap hid a distinct kind of problem');

      const all = cli(['lint', d, '--all']);
      expectCode('--all exits 1 too', all, 1);
      check('--all prints every dangling ref', (all.out.match(/FAIL  dangling-ref/g) || []).length === 30,
        `saw ${(all.out.match(/FAIL  dangling-ref/g) || []).length}`);
      check('--all prints no truncation notice', !/more dangling-ref/.test(all.out), 'still truncated');

      const js = cli(['lint', d, '--json']);
      let parsed = null;
      try { parsed = JSON.parse(js.out); } catch { /* reported below */ }
      check('--json is unbounded regardless of the cap', parsed?.violations?.length === 31, `got ${parsed?.violations?.length}`);
    }


    // -- doctor names what is wrong, not just how much ----------------------------
    {
      const files = { 'relations.json': DECL, 'zones/zn_haven.tres': 'script_class="ZoneData"\nid = "zn_haven"\n' };
      for (let i = 0; i < 5; i++) files[`npcs/npc_${i}.tres`] = `script_class="NpcData"\nid = "npc_${i}"\nhome_zone_id = "zn_gone"\n`;
      const d = make(files);
      const r = cli(['doctor', d]);
      expectCode('doctor exits 1 on violations', r, 1);
      check('doctor breaks violations down by code', /by code:/.test(r.out), r.out.trim());
      check('doctor names the code and its worst family', /dangling-ref\s+- npcs \(5\)/.test(r.out),
        r.out.split('\n').find((l) => /dangling-ref/.test(l)) || 'no row');
    }

    // -- an unreadably large tree is refused by name, not killed by the OOM killer ----
    // 1M records is measured to run (2.77GB peak RSS against a 4.3GB default heap), but
    // past ~1.5M V8 aborts with SIGABRT (exit 134) after minutes of mark-compact
    // thrashing - outside the 0/1/2 contract. The ceiling is env-overridable so this
    // test can drive it with 3 files instead of 1.5 million.
    {
      const d = make(CLEAN);
      const prev = process.env.TRES_MAX_RECORDS;
      process.env.TRES_MAX_RECORDS = '1';
      const r = cli(['lint', d]);
      if (prev === undefined) delete process.env.TRES_MAX_RECORDS;
      else process.env.TRES_MAX_RECORDS = prev;
      expectCode('an over-ceiling tree is a usage refusal (exit 2)', r, 2);
      check('the refusal names the ceiling and the file count',
        /exceeds the 1-record ceiling/.test(r.err) && /2 \.tres files/.test(r.err), r.err.trim());
      check('the refusal is not a crash (no V8 stack)', !/mark-compact|Last few GCs|SIGABRT/.test(r.err), r.err.trim().slice(0, 120));
    }

    // -- the heap estimator matches what the reader actually costs --------------------
    // Node clamps --max-old-space-size to a 200MB floor, so the guard cannot be driven by
    // shrinking the heap in a test. Assert the model instead, against the corpora it was
    // fitted to: if the coefficients drift, the guard starts refusing trees that fit (or
    // admitting trees that abort), and this fails before either happens for real.
    {
      const measured = [
        { name: '200k smallest records (46B)', records: 200000, source: 9.4e6, heap: 223e6 },
        { name: '200k large records (7.6KB)', records: 200000, source: 1444e6, heap: 4915e6 },
        { name: '743k typical records', records: 743403, source: 553e6, heap: 2485e6 },
      ];
      for (const m of measured) {
        const est = estimateHeap(m.records, m.source);
        const err = Math.abs(est - m.heap) / m.heap;
        check(`the heap estimate is within 10% for ${m.name}`, err < 0.10,
          `estimated ${Math.round(est / 1e6)}MB, measured ${Math.round(m.heap / 1e6)}MB (${(err * 100).toFixed(1)}% off)`);
      }
    }

    // --- audit regressions: silent passes found by reading the rules, not the tests ---
    // Each case below was a CLEAN EXIT over a tree that was not clean. They are grouped
    // because they share one cause: a check that could not see the data reported success.
    {
      // A cycle is a chain, not a pair (SPEC section 7). The old rule followed one hop
      // and looked for an immediate return, so A<->B refused while a->b->c->a passed.
      const d = make({
        'relations.json': JSON.stringify({
          schemaVersion: 1,
          families: [{ key: 'things' }],
          edges: [{ family: 'things', field: 'next_id', kind: 'ref', target: 'things', required: true }],
        }),
        'things/a.tres': 'id = "a"\nnext_id = "b"\n',
        'things/b.tres': 'id = "b"\nnext_id = "c"\n',
        'things/c.tres': 'id = "c"\nnext_id = "a"\n',
      });
      const r = cli(['lint', d]);
      expectCode('a three-node cycle exits 1', r, 1);
      check('a three-node cycle is reported', /FAIL\s+cycle/.test(r.out), r.out.trim().split('\n').slice(0, 4).join(' | '));
      check('the cycle is reported once, not once per node', (r.out.match(/FAIL\s+cycle/g) || []).length === 1,
        `saw ${(r.out.match(/FAIL\s+cycle/g) || []).length}`);

      // The same tree with the cycle broken must be clean: the fix must not refuse chains.
      const ok = make({
        'relations.json': JSON.stringify({
          schemaVersion: 1,
          families: [{ key: 'things' }],
          edges: [{ family: 'things', field: 'next_id', kind: 'ref', target: 'things', required: true }],
        }),
        'things/a.tres': 'id = "a"\nnext_id = "b"\n',
        'things/b.tres': 'id = "b"\nnext_id = "c"\n',
        'things/c.tres': 'id = "c"\n',
      });
      expectCode('an acyclic chain of three is clean', cli(['lint', ok]), 0);
    }

    {
      // A dict written on ONE line is the same dict. Reading keys only at line starts
      // made `entries = [{ "item_id": "x" }]` carry no nested keys at all, so a declared
      // `nested` edge found nothing to check and reported clean.
      const decl = JSON.stringify({
        schemaVersion: 1,
        families: [{ key: 'f' }, { key: 'items' }],
        edges: [{ family: 'f', field: 'entries.item_id', kind: 'nested', target: 'items', required: true }],
      });
      const oneLine = make({
        'relations.json': decl,
        'items/real_item.tres': 'id = "real_item"\n',
        'f/a.tres': 'id = "a"\nentries = [{ "item_id": "does_not_exist" }]\n',
      });
      const r1 = cli(['lint', oneLine]);
      expectCode('a dangling nested ref on ONE line exits 1', r1, 1);
      check('a dangling nested ref on one line is named', /dangling-ref/.test(r1.out), r1.out.trim().split('\n').slice(0, 4).join(' | '));

      const multi = make({
        'relations.json': decl,
        'items/real_item.tres': 'id = "real_item"\n',
        'f/a.tres': 'id = "a"\nentries = [{\n"item_id": "does_not_exist"\n}]\n',
      });
      check('the multi-line form agrees with the one-line form', cli(['lint', multi]).code === 1, 'multi-line form passed');

      const valid = make({
        'relations.json': decl,
        'items/real_item.tres': 'id = "real_item"\n',
        'f/a.tres': 'id = "a"\nentries = [{ "item_id": "real_item" }]\n',
      });
      expectCode('a resolving nested ref on one line is clean', cli(['lint', valid]), 0);
    }

    {
      // Declaration SHAPE typos that used to disable a whole rule class or crash.
      const base = { schemaVersion: 1, families: [{ key: 'f' }], edges: [] };
      const shape = (label, decl, want) => {
        const d = make({ 'relations.json': JSON.stringify(decl), 'f/a.tres': 'id = "a"\n' });
        const r = cli(['lint', d]);
        check(`${label} is refused, not ignored`, r.code === want, `exit ${r.code}`);
      };
      // A string here makes every `<stem>` lookup return undefined, and an undefined
      // mapping means "nothing to check" - so every virtual edge silently stopped
      // checking its captures.
      shape('virtualFamilies as a string', { ...base, virtualFamilies: 'f' }, 1);
      shape('virtualFamilies naming an undeclared family', { ...base, virtualFamilies: { s: 'nofam' } }, 1);
      // A string is iterable, so it was walked per character: 3 bogus findings per letter,
      // which is 6,000 findings for a 2,000-character typo - the real problem buried under
      // noise it generated itself. Exit code alone cannot see that, so this asserts the
      // finding COUNT: one named refusal, not one per character.
      {
        const d = make({ 'relations.json': JSON.stringify({ ...base, baselines: 'nope' }), 'f/a.tres': 'id = "a"\n' });
        const r = cli(['lint', d]);
        check('baselines as a string exits 1', r.code === 1, `exit ${r.code}`);
        const declLines = (r.err.match(/DECL /g) || []).length;
        check('baselines as a string yields ONE refusal, not one per character', declLines === 1,
          `${declLines} DECL line(s) for a 4-character string`);
        check('the baselines refusal names the shape', /baselines MUST be an array/.test(r.err), r.err.split('\n')[0] || 'no stderr');
      }
      // These two threw `Cannot read properties of null` - an exit-2 stack trace where
      // a named declaration refusal belongs.
      shape('an edge row that is null', { ...base, edges: [null] }, 1);
      shape('a family entry that is null', { ...base, families: [null] }, 1);
      shape('an edge row with no family', { ...base, edges: [{ field: 'x_id', kind: 'ref', target: 'f' }] }, 1);
      shape('an edge row with no field', { ...base, edges: [{ family: 'f', kind: 'ref', target: 'f' }] }, 1);
      // And a well-formed declaration must still pass, or the guards are just refusals.
      shape('a well-formed declaration', { ...base, edges: [{ family: 'f', field: 'x_id', kind: 'ref', target: 'f' }] }, 0);
    }

    {
      // A pattern with many stems is author-supplied data, and the backtracking matcher
      // is exponential without memoization: 8 stems against an unsatisfiable value took
      // 5.2s for ONE value (measured), so a 100-record family hung for ~8 minutes. A
      // declaration must never be able to make the linter stop answering.
      const L = 40;
      const files = { 'relations.json': JSON.stringify({
        schemaVersion: 1,
        families: [{ key: 'f' }],
        edges: [{ family: 'f', field: 'ref_id', kind: 'virtual', pattern: '<s1><s2><s3><s4><s5><s6><s7><s8>' }],
        virtualFamilies: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`s${i}`, 'f'])),
      }) };
      for (let i = 1; i <= L; i++) files[`f/${'z'.repeat(i)}.tres`] = `id = "${'z'.repeat(i)}"\n`;
      // A lowercase tail: `idsIn` only admits lowercase-led values, so an uppercase
      // character would remove the value from the scan entirely and test nothing.
      files['f/rec.tres'] = `id = "rec"\nref_id = "${'z'.repeat(L)}q"\n`;
      const d = make(files);
      const started = Date.now();
      const r = cli(['lint', d]);
      const ms = Date.now() - started;
      check('an 8-stem virtual pattern answers in under 5s', ms < 5000, `took ${ms}ms`);
      expectCode('the unsatisfiable virtual value is still refused', r, 1);
      check('the unsatisfiable virtual value is named', /dangling-ref/.test(r.out), 'no dangling-ref');
    }



  }

  // --- the package API surface (issue #24) ---------------------------------
  // `exports` is the public API: a host that wants lint-on-save must be able to
  // `import 'tresridge'`, not reach into `src/`. These spawn a real resolver
  // because an exports map is enforced by Node's loader, not by anything the
  // library can assert about itself - reading package.json proves nothing.
  {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    check('the package declares an exports map', !!pkg.exports, 'no exports field');
    check('the root subpath is exported', pkg.exports?.['.'] !== undefined, 'no "." entry');
    check('graph is exported', pkg.exports?.['./graph'] !== undefined, 'no "./graph" entry');
    check('rules is exported', pkg.exports?.['./rules'] !== undefined, 'no "./rules" entry');
    check('the spec is exported', pkg.exports?.['./spec/*'] !== undefined, 'no "./spec/*" entry');

    // Every exports target must be a file that actually exists - a typo here is
    // an import that fails only after publish.
    for (const [sub, rel] of Object.entries(pkg.exports || {}).filter(([k]) => !k.includes('*'))) {
      let exists = true;
      try { readFileSync(join(ROOT, rel)); } catch { exists = false; }
      check(`exports target for "${sub}" exists`, exists, `${rel} missing`);
    }

    // The real proof: resolve by package name from outside the repo, the way a
    // consumer would. Reading package.json proves nothing; Node's loader decides.
    const consumer = mkdtempSync(join(tmpdir(), 'tresridge-consumer-'));
    dirs.push(consumer);
    mkdirSync(join(consumer, 'node_modules'), { recursive: true });
    try {
      const { symlinkSync } = await import('node:fs');
      symlinkSync(ROOT, join(consumer, 'node_modules', 'tresridge'), 'dir');
    } catch { /* a stale link on a re-run; the import probe below decides */ }

    const probe = (spec) => {
      try {
        const out = execFileSync(process.execPath, [
          '--input-type=module', '-e',
          `import('${spec}').then(m=>console.log(JSON.stringify(Object.keys(m))))`,
        ], { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, keys: JSON.parse(out.trim()) };
      } catch (e) {
        return { ok: false, err: String(e.stderr || e.message) };
      }
    };

    const root = probe('tresridge');
    check('a consumer can import "tresridge" by name', root.ok, root.err?.split('\n')[0]);
    check('the root export carries lint()', root.ok && root.keys.includes('lint'), JSON.stringify(root.keys));
    check('the root export carries lintRoot()', root.ok && root.keys.includes('lintRoot'), JSON.stringify(root.keys));

    const g = probe('tresridge/graph');
    check('a consumer can import "tresridge/graph"', g.ok, g.err?.split('\n')[0]);
    check('the graph export carries inferDeclaration()', g.ok && g.keys.includes('inferDeclaration'), JSON.stringify(g.keys));

    // A deep src/ path must NOT resolve: that is the point of the map. If this
    // passes, the map is absent or a wildcard leaked the internals back open.
    const deep = probe('tresridge/src/lint.mjs');
    check('a deep src/ import is refused by the exports map', !deep.ok, 'src/ is still reachable');
  }

} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n  REFUSED: ${fails.length} of ${checks} CLI check(s) failed.`);
  process.exit(1);
}
console.log(`  ${checks} CLI check(s) honest.`);
