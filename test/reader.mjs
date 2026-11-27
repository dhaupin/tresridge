// The reader seam: what a host's `--reader` module owes tresridge, and what
// tresridge owes the host when it gets something else.
//
// `--reader` moved the walk and the parse out of this package, and every case here
// was found by pointing it at a real JSON tree (a field guide, 198 records) rather
// than at the `.tres` fixtures the rest of the suite uses. The defects are the kind
// a fixture cannot show: a verdict that leaves the process in pieces, a record that
// throws and names no file, and a declaration whose field path is read one level
// shallower than it was written.
//
// Nothing here is mocked. Every case writes real bytes into a temp dir and runs the
// real CLI, because the exit code and the stdout bytes ARE the contract.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quotedValues } from '../src/rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.mjs');

const fails = [];
const dirs = [];
let checks = 0;

function check(name, ok, detail = '') {
  checks++;
  if (ok) return;
  fails.push({ name, detail });
  console.error(`  FAIL  ${name}  <- ${detail}`);
}

function expectCode(name, r, code) {
  check(name, r.code === code, `exit ${r.code}, want ${code} (err: ${r.err.trim().slice(0, 160) || '-'})`);
}

/**
 * Run the CLI with stdout on a PIPE - which is what every host does, and the only
 * configuration where a buffered write can be lost.
 */
function cli(args, cwd = ROOT) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'tresridge-reader-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const json = (v) => JSON.stringify(v, null, 2);

/** A reader over `.json` records, with `over` spliced in to break one contract term. */
function readerSource(over = {}) {
  return `import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

function walkDir(root) {
  const out = []
  for (const name of readdirSync(root).sort()) {
    const full = join(root, name)
    if (statSync(full).isDirectory()) out.push(...walkDir(full))
    else if (extname(full) === '.json') out.push(full)
  }
  return out
}

export const reader = {
  name: ${JSON.stringify(over.name ?? '.json')},
  ext: ${JSON.stringify(over.ext ?? '.json')},
  walk(root) {
    const files = walkDir(root)
    ${over.walk ?? ''}
    return files
  },
  parse(file) {
    ${over.parse ?? ''}
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    const fields = new Map()
    const nested = new Map()
    for (const [key, value] of Object.entries(doc)) {
      fields.set(key, JSON.stringify(value))
      if (Array.isArray(value)) {
        const inner = new Map()
        for (const v of value) {
          if (!v || typeof v !== 'object') continue
          for (const [k, val] of Object.entries(v)) {
            const arr = inner.get(k) || []
            arr.push(JSON.stringify(val))
            inner.set(k, arr)
          }
        }
        if (inner.size) nested.set(key, inner)
      }
    }
    return { id: basename(file, '.json'), idDeclared: false, scriptClass: '', fields, nested }
  },
}
`;
}

/** A one-family JSON tree with a `related` refs edge to itself. */
function smallTree(over = {}, records = { 'a/one.json': { term: 'One', related: ['one'] } }, decl = {
  schemaVersion: 1,
  families: [{ key: 'a' }],
  edges: [{ family: 'a', field: 'related', kind: 'refs', target: ['a'] }],
}) {
  // The declaration lives OUTSIDE the tree: it is the tree's contract, not a record,
  // and a reader that walks every .json under the root would otherwise read it as one.
  const files = { 'relations.json': json(decl), 'reader.mjs': readerSource(over) };
  for (const [rel, body] of Object.entries(records)) files[`tree/${rel}`] = json(body);
  return make(files);
}

const lint = (dir, extra = []) => cli(['lint', `${dir}/tree`, '--reader', `${dir}/reader.mjs`, '--decl', `${dir}/relations.json`, '--json', ...extra]);

const parseJson = (out) => {
  try { return JSON.parse(out.slice(out.indexOf('{'))); } catch { return null; }
};

try {
  // --- the verdict leaves whole ---------------------------------------------
  //
  // `process.exit()` does not wait for a pipe. A verdict over ~150KB was cut off
  // mid-string, so the host's JSON.parse failed on a payload the tool had produced
  // in full - a gate that reads the machine output could not read it at all.
  {
    const records = {};
    for (let i = 0; i < 900; i++) {
      records[`a/r${String(i).padStart(4, '0')}.json`] = {
        term: `Record ${i}`,
        related: [`missing_target_${String(i).padStart(4, '0')}_with_a_tail_long_enough_to_make_the_payload_realistic`],
      };
    }
    const d = smallTree({}, records);
    const r = lint(d);
    const verdict = parseJson(r.out);
    check('a large --json verdict survives a pipe intact', verdict !== null, `${r.out.length} bytes, tail: ${JSON.stringify(r.out.slice(-40))}`);
    check('a large --json verdict keeps every finding', verdict?.violations.length === 900, `${verdict?.violations.length} of 900`);
    expectCode('a large --json verdict keeps its exit code', r, 1);
    check('the large verdict is over the 64KB pipe buffer', r.out.length > 65536, `${r.out.length} bytes`);
  }

  // --- a record the reader cannot parse is named, not dropped ----------------
  //
  // A throw inside `parse` used to end the run with the reader's own message
  // (`Expected double-quoted property name in JSON at position 23`) and no file.
  {
    const d = smallTree({
      parse: "if (file.endsWith('bad.json')) throw new Error('malformed record');",
    }, {
      'a/one.json': { term: 'One', related: ['one'] },
      'a/bad.json': { term: 'Bad', related: ['one'] },
    });
    const r = lint(d);
    const verdict = parseJson(r.out);
    expectCode('a record the reader throws on is a refusal, not a crash', r, 1);
    const f = verdict?.violations.find((v) => v.code === 'unparseable-record');
    check('the unparseable finding names the file', f?.record === 'a/bad.json', JSON.stringify(f));
    check('the unparseable finding carries the reader reason', /malformed record/.test(f?.detail || ''), f?.detail);
  }

  // --- a reader that fails on EVERY record is the reader's fault ------------
  {
    const d = smallTree({ parse: "throw new Error('nope');" });
    const r = lint(d);
    expectCode('a reader that fails on every record is refused', r, 2);
    check('the refusal names the reader, not the tree', /reader\.parse\(\) failed for all 1 record/.test(r.err), r.err.trim());
  }

  // --- the parse result is checked at the seam ------------------------------
  //
  // `fields` as a plain object used to surface as `r.fields.keys is not a
  // function`, from inside a rule, naming nothing a host could act on.
  {
    const d = smallTree({
      parse: "if (file.endsWith('one.json')) return { id: 'one', fields: {}, nested: new Map() };",
    });
    const r = lint(d);
    expectCode('a parse result whose fields is not a Map is refused', r, 2);
    check('the refusal names the file and the expected shape', /fields.*Map/.test(r.err) && /a\/one\.json/.test(r.err), r.err.trim());
  }

  // --- walk owes absolute, existing paths -----------------------------------
  {
    const d = smallTree({ walk: 'return files.map((f) => f.slice(root.length + 1));' });
    const r = lint(d);
    expectCode('a walk that returns relative paths is refused', r, 2);
    check('the refusal names the contract', /ABSOLUTE record paths/.test(r.err), r.err.trim());
  }

  {
    const d = smallTree({ walk: "return [...files, `${root}/a/ghost.json`];" });
    const r = lint(d);
    expectCode('a walk that names a missing file is refused', r, 2);
    check('the refusal names the file', /ghost\.json.*does not exist/.test(r.err), r.err.trim());
  }

  {
    const d = smallTree({ walk: "throw new Error('index blew up');" });
    const r = lint(d);
    expectCode('a walk that throws is refused', r, 2);
    check('the refusal names the phase', /reader\.walk\(.*\) failed: index blew up/.test(r.err), r.err.trim());
  }

  // --- a field path is read one dict level deep, or refused ------------------
  //
  // `edges[].meta.to` fell through to the OUTER field and judged every quoted
  // string in it, so a path typo read as a wall of findings about a field nobody
  // declared. It is a declaration defect and is named once.
  {
    const d = smallTree({}, { 'a/one.json': { term: 'One', related: ['one'], edges: [{ to: 'one', kind: 'cites' }] } }, {
      schemaVersion: 1,
      families: [{ key: 'a' }],
      edges: [{ family: 'a', field: 'edges[].meta.to', kind: 'nested', target: ['a'] }],
    });
    const r = lint(d);
    expectCode('a three-level edge path is refused', r, 1);
    // A declaration refusal is printed on stderr (it is a `DECL` line, not a verdict),
    // and the run stops before the lint, so nothing is judged at all.
    check('the refusal names the path and the depth it can read', /ONE dict level/.test(r.err) && /edges\[\]\.meta\.to/.test(r.err), r.err.trim().slice(0, 200));
    check('the misdeclared path invents no per-record findings', r.out.trim() === '', r.out.slice(0, 120));
  }

  // --- a value carrying a quote is one value --------------------------------
  //
  // The regex reader stopped at the backslash: `He said "no"` arrived as fragments,
  // so the finding showed a truncated target and a reference that resolves could be
  // read as dangling.
  {
    check('quotedValues unwraps an escaped quote', JSON.stringify(quotedValues('"He said \\"no\\""')) === JSON.stringify(['He said "no"']), JSON.stringify(quotedValues('"He said \\"no\\""')));
    check('quotedValues reads an array of values', JSON.stringify(quotedValues('["a","b"]')) === JSON.stringify(['a', 'b']), JSON.stringify(quotedValues('["a","b"]')));
    check('quotedValues leaves other backslashes alone', JSON.stringify(quotedValues('"a\\\\b"')) === JSON.stringify(['a\\\\b']), JSON.stringify(quotedValues('"a\\\\b"')));

    const d = smallTree({}, { 'a/one.json': { term: 'One', related: ['He said "no"'] } });
    const r = lint(d);
    const f = parseJson(r.out)?.violations[0];
    check('a finding reports the quoted value verbatim', f?.target === 'He said "no"', JSON.stringify(f?.target));
  }

  // --- the drift gate does not call a working declaration drift ------------
  //
  // `graph --against` compared the declaration to what INFERENCE could see. A host
  // whose references are named `to`/`related` has fields no naming rule resolves, so
  // inference sees none of them and every declared row read as "removed": a healthy
  // 23-row declaration reported "0 added, 23 removed" and exit 1 on the first run.
  // A row is only gone when the FIELD is gone.
  {
    const decl = (edges) => json({ schemaVersion: 1, families: [{ key: 'a' }, { key: 'b' }], edges });
    const files = {
      'relations.json': decl([
        { family: 'a', field: 'to', kind: 'refs', target: ['a', 'b'] },
        { family: 'a', field: 'gone', kind: 'refs', target: ['b'] },
      ]),
      'reader.mjs': readerSource(),
      'tree/a/one.json': json({ term: 'One', to: ['two'] }),
      'tree/b/two.json': json({ term: 'Two' }),
    };
    const d = make(files);
    const run = (declPath) => cli(['graph', `${d}/tree`, '--reader', `${d}/reader.mjs`, '--against', declPath, '--json']);

    const r = run(`${d}/relations.json`);
    const diff = parseJson(r.out);
    check('a declaration broader than the evidence is not drift', !diff?.removed.some((e) => e.field === 'to'), JSON.stringify(diff?.removed));
    check('a declared row whose field is gone is drift', diff?.removed.some((e) => e.field === 'gone'), JSON.stringify(diff?.removed));
    expectCode('a declaration with one dead row exits 1', r, 1);

    // Retargeting the row at a family the evidence contradicts is drift, whatever the
    // field's presence: the declaration would enforce a rule the data breaks.
    const wrong = join(d, 'wrong.json');
    writeFileSync(wrong, decl([{ family: 'a', field: 'to', kind: 'refs', target: ['a'] }]));
    const rw = run(wrong);
    check('a target the evidence escapes is drift', parseJson(rw.out)?.removed.some((e) => e.field === 'to'), rw.out.slice(0, 200));
    expectCode('a contradicting target exits 1', rw, 1);

    // A field inference cannot see but that is still in the tree is reported, not
    // counted as drift: it is the declaration doing the work the naming rule cannot.
    const clean = join(d, 'clean.json');
    writeFileSync(clean, decl([{ family: 'a', field: 'to', kind: 'refs', target: ['a', 'b'] }]));
    const rc = run(clean);
    const dc = parseJson(rc.out);
    check('a working declaration reports nothing removed', dc?.removed.length === 0, JSON.stringify(dc?.removed));
    expectCode('a working declaration exits 0', rc, 0);
  }

  // --- the root guard reads the reader's EXT, not its label -----------------
  //
  // `reader.name` is a label and may be prose ("json records"). The guard compared
  // family keys against it, so a root one level too low read as a plausible tree.
  {
    const d = smallTree({ name: 'json records' });
    const r = cli(['lint', `${d}/tree/a`, '--reader', `${d}/reader.mjs`, '--decl', `${d}/relations.json`]);
    expectCode('a family directory is refused as a root for a labelled reader', r, 2);
    check('the refusal is not-a-tree-root', /not-a-tree-root/.test(r.err), r.err.trim());
  }

  // ...and the declaration is read the same way through `--json` on `graph`.
  {
    const d = smallTree();
    const r = cli(['graph', `${d}/tree`, '--reader', `${d}/reader.mjs`, '--json']);
    expectCode('graph --json over a reader tree stays clean', r, 0);
    check('graph --json parses', parseJson(r.out) !== null, r.out.slice(0, 120));
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n  REFUSED: ${fails.length} of ${checks} reader check(s) failed.`);
  process.exit(1);
}
console.log(`  ${checks} reader check(s) honest.`);
