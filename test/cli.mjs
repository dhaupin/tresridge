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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.mjs');

const fails = [];
let checks = 0;

/** Run the CLI. Returns { code, out, err } and never throws on a non-zero exit. */
function cli(args, cwd = ROOT) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
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
    check('rules lists the vocabulary', /13 refusal codes/.test(r.out), r.out.trim());
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
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n  REFUSED: ${fails.length} of ${checks} CLI check(s) failed.`);
  process.exit(1);
}
console.log(`  ${checks} CLI check(s) honest.`);
