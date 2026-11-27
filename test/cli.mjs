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

    // A field the declaration ALREADY names is an ANSWERED probable row: it must leave
    // the on-ramp list, or the list never shrinks and adopting the tool never converges.
    // The pair below is the proof: identical tree, identical inference, and the ONLY
    // difference is whether a declaration answers the row.
    {
      const files = {
        'species/sp_1.tres': 'script_class="SpeciesData"\nid = "sp_1"\n',
        'fallacies/fal_1.tres': 'script_class="FallacyData"\nid = "fal_1"\nrels = [{\n"to": "sp_1"\n}]\n',
      };
      const decl = JSON.stringify({
        schemaVersion: 1,
        families: [{ key: 'species' }, { key: 'fallacies' }],
        edges: [{ family: 'fallacies', field: 'rels.to', target: 'species', kind: 'nested' }],
      });

      const bare = make(files);
      const before = JSON.parse(cli(['graph', bare, '--json'], bare).out);
      check('an unanswered probable field IS offered',
        (before.residue.probable || []).some((x) => x.field === 'rels.to'),
        JSON.stringify(before.residue.probable));

      const answered = make({ ...files, 'relations.json': decl });
      const after = JSON.parse(cli(['graph', answered, '--json'], answered).out);
      check('a declared probable field leaves the on-ramp list',
        !(after.residue.probable || []).some((x) => x.field === 'rels.to'),
        JSON.stringify(after.residue.probable));
    }

    // The filter must NOT feed the drift gate: a declared probable field is the ANSWER
    // to a residue row, so the row has to survive into the diff for the exemption to
    // apply. Filtering the diff's input once reported 20 phantom removals.
    {
      const d = make({
        'species/sp_1.tres': 'script_class="SpeciesData"\nid = "sp_1"\n',
        'fallacies/fal_1.tres': 'script_class="FallacyData"\nid = "fal_1"\nrels = [{\n"to": "sp_1"\n}]\n',
      });
      const decl = join(d, 'relations.json');
      writeFileSync(decl, JSON.stringify({
        schemaVersion: 1,
        families: [{ key: 'species' }, { key: 'fallacies' }],
        edges: [{ family: 'fallacies', field: 'rels.to', target: 'species', kind: 'nested' }],
      }));
      const r = cli(['graph', d, '--against', decl, '--json'], d);
      const diff = JSON.parse(r.out);
      check('a declared probable field is not reported as removed drift',
        diff.removed.length === 0, JSON.stringify(diff.removed));
      check('the drift gate is quiet for a correct probable declaration',
        r.code === 0, `${r.code}: ${r.out.trim()}`);
    }

    // A nested key whose value is itself an array/dict is a CONTAINER: its quoted keys
    // are structure, not candidate ids. Reading them invented a probable row for
    // `hordes.waves.spawns` (whose real reference is one level deeper than this
    // standard reads), and the row could never be answered.
    {
      const d = make({
        'species/sp_1.tres': 'script_class="SpeciesData"\nid = "sp_1"\n',
        'fallacies/fal_1.tres': 'script_class="FallacyData"\nid = "fal_1"\nwaves = [{\n"spawns": [{\n"template_id": "sp_1",\n"count": 5\n}]\n}]\n',
      });
      const parsed = JSON.parse(cli(['graph', d, '--json']).out);
      check('a nested container is not probable residue',
        !(parsed.residue.probable || []).some((x) => x.field === 'waves.spawns'),
        JSON.stringify(parsed.residue.probable));
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

  // `graph` reads the declaration RAW (it may be the draft target), so it must
  // validate before dereferencing `edges` - the same named refusal `lint` and
  // `doctor` give, not a raw TypeError from the `.map`.
  {
    const d = make(CLEAN);
    writeFileSync(join(d, 'relations.json'), JSON.stringify({ schemaVersion: 1, families: ['zones', 'npcs'], edges: {} }));
    const r = cli(['graph', d, '--decl', join(d, 'relations.json')]);
    expectCode('graph with a non-array edges declaration exits 1', r, 1);
    check('graph reports a non-array edges declaration as DECL', /DECL .*edges MUST be an array/.test(r.err), r.err.trim() || r.out.trim());
    check('graph does not leak a raw TypeError on a malformed declaration', !/is not a function|Cannot read/.test(r.err + r.out), (r.err + r.out).trim());
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
      // The cycle walk read `idsIn(...)[0]`, so a cycle reachable through any LATER
      // value of a multi-valued field was invisible, while `dangling-ref` judged every
      // value. Order alone decided the verdict: ["zn_a","zn_x"] closed the loop and
      // ["zn_x","zn_a"] - the same loop - reported 0 violations. Both orderings are
      // pinned below because a single ordering is what let the gap survive.
      const decl = JSON.stringify({
        schemaVersion: 1,
        families: [{ key: 'npcs' }, { key: 'zones' }],
        edges: [
          { family: 'npcs', field: 'zone_id', target: 'zones', kind: 'ref', required: true },
          { family: 'zones', field: 'zone_id', target: 'npcs', kind: 'ref', required: true },
        ],
      });
      const mk = (npcZoneId) => tree({
        'relations.json': decl,
        'npcs/npc_a.tres': `id = "npc_a"\nzone_id = ${npcZoneId}\n`,
        'zones/zn_a.tres': 'id = "zn_a"\nzone_id = "npc_a"\n',
        'zones/zn_x.tres': 'id = "zn_x"\n',
      });
      for (const [label, value] of [['first', '["zn_a", "zn_x"]'], ['second', '["zn_x", "zn_a"]']]) {
        const r = cli(['lint', mk(value)]);
        expectCode(`a cycle through the ${label} value of a multi-valued ref exits 1`, r, 1);
        check(`a cycle through the ${label} value is reported`, /FAIL\s+cycle/.test(r.out), r.out.trim().split('\n').slice(0, 4).join(' | '));
      }
      // ...and branching must not invent cycles: the same shape with no loop stays clean.
      const acyclic = tree({
        'relations.json': decl,
        'npcs/npc_a.tres': 'id = "npc_a"\nzone_id = ["zn_x", "zn_y"]\n',
        'zones/zn_x.tres': 'id = "zn_x"\n',
        'zones/zn_y.tres': 'id = "zn_y"\n',
      });
      expectCode('a multi-valued ref with no loop is clean', cli(['lint', acyclic]), 0);
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

  // --- the transport seam (issue #23) ---------------------------------------
  // The grammar is format-independent; only the walker and parser were `.tres`. A host
  // whose records live in JSON had to convert its whole tree first, which meant linting
  // a copy that can drift from the real records. `--reader` supplies the pair.
  {
    const readerSrc = `
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
export const reader = {
  name: '.json',
  ext: '.json',
  walk(root) {
    const out = [];
    const visit = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) visit(full);
        else if (e.name.endsWith('.json') && e.name !== 'relations.json') out.push(full);
      }
    };
    visit(root);
    return out.sort();
  },
  parse(file) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const fields = new Map();
    const targets = (doc.edges || []).map((e) => e.to.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    if (targets.length) fields.set('edges', JSON.stringify(targets));
    return { id: basename(file, '.json'), idDeclared: false, scriptClass: '', fields, nested: new Map() };
  },
};
`;
    const JSON_DECL = JSON.stringify({
      schemaVersion: 1,
      families: [
        { key: 'species', schema: '', idPrefix: '' },
        { key: 'fallacies', schema: '', idPrefix: '' },
      ],
      edges: [{ family: 'species', field: 'edges', target: 'fallacies', kind: 'refs', required: true }],
    }, null, 2) + '\n';

    const dir = tree({
      'reader.mjs': readerSrc,
      'relations.json': JSON_DECL,
      'fallacies/ad-hominem.json': '{ "term": "Ad hominem", "edges": [] }\n',
      'species/freetard.json': '{ "term": "Freetard", "edges": [{ "rel": "commits", "to": "Ad hominem" }] }\n',
    });
    dirs.push(dir);
    const readerPath = join(dir, 'reader.mjs');

    // Without the seam the same tree is invisible - this is the #23 repro.
    const bare = cli(['doctor', dir]);
    check('a JSON tree without --reader is empty-tree', bare.code === 2 && /empty-tree/.test(bare.err), bare.err.trim());

    const clean = cli(['lint', dir, '--reader', readerPath]);
    check('a JSON tree lints clean through --reader', clean.code === 0, clean.out.trim() + clean.err.trim());
    check('the JSON tree reports its real families and records', /2 families, 2 records/.test(clean.out), clean.out.trim());
    check('the JSON tree resolves a real edge', /1 edges/.test(clean.out), clean.out.trim());

    // A clean pass proves nothing on its own: the seam must still SEE a broken edge.
    const broken = tree({
      'reader.mjs': readerSrc,
      'relations.json': JSON_DECL,
      'fallacies/ad-hominem.json': '{ "term": "Ad hominem", "edges": [] }\n',
      'species/freetard.json': '{ "term": "Freetard", "edges": [{ "rel": "commits", "to": "No Such Fallacy" }] }\n',
    });
    dirs.push(broken);
    const bad = cli(['lint', broken, '--reader', join(broken, 'reader.mjs')]);
    check('a dangling edge in a JSON tree fails the lint', bad.code === 1, bad.out.trim());
    check('the dangling JSON edge is named', /dangling-ref/.test(bad.out), bad.out.trim());

    // The reader is a contract, so a module that does not honour it is refused by name
    // rather than failing somewhere deep in the walk.
    const halfReader = tree({ 'r.mjs': 'export const reader = { name: ".json" };\n' });
    dirs.push(halfReader);
    const half = cli(['lint', dir, '--reader', join(halfReader, 'r.mjs')]);
    check('a reader without walk/parse is refused', half.code === 2 && /--reader module/.test(half.err), half.err.trim());

    const missing = cli(['lint', dir, '--reader', join(dir, 'nope.mjs')]);
    check('a missing --reader module is refused', missing.code === 2 && /not found/.test(missing.err), missing.err.trim());

    // A nested edge reads `nested`, and its values must be RAW source text. A reader
    // that hands back bare strings parses fine, matches no quoted value, and reports
    // 0 edges with a clean exit - a silent pass. Hold both halves of that.
    const nestedReader = `
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const reader = {
  name: '.json',
  walk(root) {
    const out = [];
    const visit = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name);
        if (e.isDirectory()) visit(f);
        else if (e.name.endsWith('.json') && e.name !== 'relations.json') out.push(f);
      }
    };
    visit(root);
    return out.sort();
  },
  parse(file) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const fields = new Map([['term', JSON.stringify(doc.term)]]);
    const nested = new Map();
    if (doc.edges?.length) nested.set('edges', new Map([['to', doc.edges.map((e) => JSON.stringify(slug(e.to)))]]));
    return { id: basename(file, '.json'), idDeclared: false, scriptClass: '', fields, nested };
  },
};
`;
    const NESTED_DECL = JSON.stringify({
      schemaVersion: 1,
      families: [
        { key: 'fallacies', schema: '', idPrefix: '' },
        { key: 'species', schema: '', idPrefix: '' },
      ],
      edges: [{ family: 'species', field: 'edges.to', target: 'fallacies', kind: 'nested', required: true }],
    }, null, 2) + '\n';

    const nestedDir = tree({
      'reader.mjs': nestedReader,
      'relations.json': NESTED_DECL,
      'fallacies/ad-hominem.json': '{ "term": "Ad hominem", "edges": [] }\n',
      'species/freetard.json': '{ "term": "Freetard", "edges": [{ "rel": "commits", "to": "Ad hominem" }] }\n',
    });
    dirs.push(nestedDir);
    const nestedOk = cli(['lint', nestedDir, '--reader', join(nestedDir, 'reader.mjs')]);
    check('a nested edge resolves through a reader', nestedOk.code === 0 && /1 edges/.test(nestedOk.out), nestedOk.out.trim());

    const nestedBroken = tree({
      'reader.mjs': nestedReader,
      'relations.json': NESTED_DECL,
      'fallacies/ad-hominem.json': '{ "term": "Ad hominem", "edges": [] }\n',
      'species/freetard.json': '{ "term": "Freetard", "edges": [{ "rel": "commits", "to": "No Such Fallacy" }] }\n',
    });
    dirs.push(nestedBroken);
    const nestedBad = cli(['lint', nestedBroken, '--reader', join(nestedBroken, 'reader.mjs')]);
    check('a dangling nested edge in a JSON tree fails', nestedBad.code === 1 && /dangling-ref/.test(nestedBad.out), nestedBad.out.trim());

    // The silent-pass guard: unquoted values must NOT read as resolved edges.
    const unquotedDir = tree({
      'reader.mjs': nestedReader.replace('JSON.stringify(slug(e.to))', 'slug(e.to)'),
      'relations.json': NESTED_DECL,
      'fallacies/ad-hominem.json': '{ "term": "Ad hominem", "edges": [] }\n',
      'species/freetard.json': '{ "term": "Freetard", "edges": [{ "rel": "commits", "to": "Ad hominem" }] }\n',
    });
    dirs.push(unquotedDir);
    const unquoted = cli(['lint', unquotedDir, '--reader', join(unquotedDir, 'reader.mjs')]);
    check('unquoted reader values do not read as resolved edges', !/1 edges/.test(unquoted.out), unquoted.out.trim());
  }

  // --- the reader's SUFFIX, not `.tres` (issue: the seam's own transport) -----
  // The grammar went format-independent with `--reader`, but three rules kept
  // `.tres` hardcoded. The worst: `filename-id-mismatch` compared a declared id to
  // a stem stripped of `.tres`, so EVERY record of a non-`.tres` tree that declares
  // ids was refused - the transport the seam exists for, refused by the seam.
  {
    const declIdReader = `
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
export const reader = {
  name: '.json',
  ext: '.json',
  walk(root) {
    const out = [];
    const visit = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name);
        if (e.isDirectory()) visit(f);
        else if (e.name.endsWith('.json') && e.name !== 'relations.json') out.push(f);
      }
    };
    visit(root);
    return out.sort();
  },
  parse(file) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const fields = new Map();
    for (const [k, v] of Object.entries(doc)) if (k !== 'id') fields.set(k, JSON.stringify(v));
    // A host with an id field DECLARES it. The filename is npc_smith.json.
    return { id: doc.id, idDeclared: doc.id !== undefined, scriptClass: '', fields, nested: new Map() };
  },
};
`;
    const ID_DECL = JSON.stringify({
      schemaVersion: 1,
      families: [{ key: 'npcs', schema: '', idPrefix: '' }],
      edges: [],
    }, null, 2) + '\n';

    const declared = tree({
      'reader.mjs': declIdReader,
      'relations.json': ID_DECL,
      'npcs/npc_smith.json': '{ "id": "npc_smith", "name": "Smith" }\n',
      'npcs/npc_baker.json': '{ "id": "npc_baker", "name": "Baker" }\n',
    });
    dirs.push(declared);
    const declaredRun = cli(['lint', declared, '--reader', join(declared, 'reader.mjs')]);
    check('a declared-id JSON tree lints clean through --reader', declaredRun.code === 0,
      declaredRun.out.trim() + declaredRun.err.trim());
    check('the declared-id JSON tree reports both records', /2 records/.test(declaredRun.out), declaredRun.out.trim());

    // A real mismatch is still refused: the fix must not silence the rule.
    const mismatch = tree({
      'reader.mjs': declIdReader,
      'relations.json': ID_DECL,
      'npcs/npc_smith.json': '{ "id": "npc_baker", "name": "Smith" }\n',
    });
    dirs.push(mismatch);
    const mismatchRun = cli(['lint', mismatch, '--reader', join(mismatch, 'reader.mjs')]);
    check('a declared id that disagrees with its stem is still refused', mismatchRun.code === 1 && /filename-id-mismatch/.test(mismatchRun.out), mismatchRun.out.trim());
    check('the mismatch detail names the stem, not the file name', /found "npc_smith"/.test(mismatchRun.out) && !/found "npc_smith\.json"/.test(mismatchRun.out), mismatchRun.out.trim());

    // A prefixed family still infers its prefix from a `.json` stem, not from one
    // ending in `.json` - the same hardcode, one rule over.
    const prefixed = tree({
      'reader.mjs': declIdReader,
      'relations.json': JSON.stringify({ schemaVersion: 1, families: [{ key: 'npcs', schema: '', idPrefix: '' }], edges: [] }),
      'npcs/npc_smith.json': '{ "id": "smith" }\n',
      'npcs/npc_baker.json': '{ "id": "baker" }\n',
    });
    dirs.push(prefixed);
    const inferred = cli(['graph', prefixed, '--reader', join(prefixed, 'reader.mjs'), '--json']);
    check('graph infers an idPrefix from a .json stem', /"idPrefix":\s*"npc_"/.test(inferred.out), inferred.out.trim().slice(0, 200));

    // The empty-tree message names the reader's suffix, not `.tres`.
    const emptyJson = tree({ 'reader.mjs': declIdReader, 'relations.json': ID_DECL, 'npcs/notes.txt': 'not a record\n' });
    dirs.push(emptyJson);
    const emptyRun = cli(['lint', emptyJson, '--reader', join(emptyJson, 'reader.mjs')]);
    check('an empty JSON tree names .json, not .tres', /no \.json records/.test(emptyRun.out + emptyRun.err), (emptyRun.out + emptyRun.err).trim());
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
    // an import that fails only after publish. A subpath is a bare string or a
    // { types, default } condition object (issue #24), so read both forms.
    const targetsOf = (v) => (typeof v === 'string' ? [v] : Object.values(v));
    for (const [sub, val] of Object.entries(pkg.exports || {}).filter(([k]) => !k.includes('*'))) {
      for (const rel of targetsOf(val)) {
        let exists = true;
        try { readFileSync(join(ROOT, rel)); } catch { exists = false; }
        check(`exports target for "${sub}" exists`, exists, `${rel} missing`);
      }
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
