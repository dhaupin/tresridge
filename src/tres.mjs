// The .tres tree reader: walk a record tree into families and records.
// Host-neutral: it knows nothing about any particular game's vocabulary.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, relative, dirname } from 'node:path';

/** Walk `root` and return every `.tres` file path, recursively. */
export function walkTres(root) {
  const out = [];
  const visit = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (e.name.endsWith('.tres')) out.push(full);
    }
  };
  visit(root);
  return out.sort();
}

/** Count `{` minus `}` outside string literals - the dict-nesting delta of a line. */
function dictDelta(line) {
  let d = 0, inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') inStr = !inStr;
    else if (!inStr && c === '{') d++;
    else if (!inStr && c === '}') d--;
  }
  return d;
}

/** Count all bracket/brace openers minus closers outside strings - the value span. */
function spanDelta(line) {
  let d = 0, inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') inStr = !inStr;
    else if (!inStr && (c === '{' || c === '[')) d++;
    else if (!inStr && (c === '}' || c === ']')) d--;
  }
  return d;
}

/**
 * The level-1 keys of a dict / array-of-dicts value, and their raw value texts.
 *
 * `entries = [{ "item_id": "a" }, { "item_id": "b" }]` yields
 * `Map { item_id -> ['"a"', '"b"'] }`. Keys deeper than one dict level are NOT
 * collected - a nested edge is `entries[].item_id`, one level in, which is the
 * shape the corpus uses. Depth is tracked by counting `{}` only.
 */
function nestedKeys(raw) {
  const out = new Map();
  let d = 0;
  for (const line of raw.split('\n')) {
    if (d === 1) {
      const m = line.trim().match(/^"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:\s*(.*)$/);
      if (m) {
        const arr = out.get(m[1]) || [];
        arr.push(m[2].replace(/,\s*$/, '').trim());
        out.set(m[1], arr);
      }
    }
    d += dictDelta(line);
  }
  return out;
}

/**
 * Why a `.tres` file cannot be read as a record, or `null` if it can.
 *
 * A `.tres` file is authored by a human and merged by a human, so the two ways it
 * arrives unreadable are both worth naming: an unresolved merge conflict (the file
 * holds BOTH sides of a field, so reading either one is a guess) and a body that is
 * not a resource at all (a binary blob, a truncated write, a stray file ending
 * `.tres`).
 *
 * This exists because the parser's `[resource]` fallback - which synthetic fixtures
 * need, since they carry no header - otherwise reads garbage as a record with no
 * fields. That is a silent success over unreadable bytes, and it let a
 * conflict-marked file resolve to whichever side the parser walked last.
 */
export function unparseableReason(file) {
  return unparseableText(readFileSync(file, 'utf8'));
}

/** `unparseableReason` over already-read text, so a parse reads the file once. */
export function unparseableText(txt) {
  // git writes all three markers; any one of them means the file is mid-merge and
  // its content is not one coherent record.
  if (/^(?:<{7}|={7}|>{7})/m.test(txt)) return 'unresolved merge conflict markers';
  // Control characters never appear in a text resource (tab, CR, and LF excepted).
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(txt)) return 'binary content';
  // No `[resource]` header AND no field line: nothing to read. A synthetic fixture
  // with no header still carries `key = value` lines, so this refuses only a body
  // that is not a record at all.
  if (!txt.includes('[resource]') && !/^[a-zA-Z_][a-zA-Z0-9_]*\s*=/m.test(txt)) {
    return 'no [resource] section and no field lines';
  }
  return null;
}

/**
 * Parse one `.tres` file into { id, idDeclared, scriptClass, fields, nested }.
 *
 * Godot writes a resource's own properties as UNQUOTED `key = value` lines at
 * brace-depth 0, and a Dictionary value's entries as QUOTED `"key": value` lines.
 * Reading only depth-0 unquoted keys keeps a record's own fields apart from the
 * nested ones. (An earlier cut read both and let a nested key overwrite a
 * top-level one - `entries[].item_id` then masqueraded as a top-level `item_id`,
 * and only the LAST dict's value survived. That made the `nested` edge kind
 * unenforceable while the spec promised it.)
 */
export function parseTres(file) {
  const txt = readFileSync(file, 'utf8');
  const scriptClass = txt.match(/script_class="(\w+)"/)?.[1] || '';
  const declared = txt.match(/^id\s*=\s*"([^"]*)"/m)?.[1];
  // `idDeclared` separates "no id line" (the stem IS the id) from "an id line that
  // disagrees with the stem" (SPEC section 3, filename-id-mismatch). Collapsing the
  // two would make an id-less record unrefusable.
  const idDeclared = declared !== undefined;
  const id = idDeclared ? declared : basename(file, '.tres');
  const unparseable = unparseableText(txt);

  // Unreadable bytes carry NO fields. Reading a conflict-marked file anyway picked
  // one side of the merge and resolved it - a clean verdict over a file nobody
  // resolved. The refusal is reported by the `unparseable-record` rule; the parser's
  // job here is only to stop inventing content.
  if (unparseable) return { id, idDeclared, scriptClass, fields: new Map(), nested: new Map(), unparseable };

  // A real Godot resource puts its properties under a `[resource]` header. A
  // synthetic fixture (the conformance cases) may carry none, so fall back to the
  // whole text rather than parsing nothing.
  const marker = txt.indexOf('[resource]');
  const body = marker >= 0 ? txt.slice(marker + '[resource]'.length) : txt;

  const fields = new Map();
  const nested = new Map();
  let key = null;
  let buf = [];
  let depth = 0;

  const flush = () => {
    if (key === null) return;
    const raw = buf.join('\n').trim();
    fields.set(key, raw);
    const inner = nestedKeys(raw);
    if (inner.size) nested.set(key, inner);
    key = null;
    buf = [];
  };

  for (const line of body.split('\n')) {
    if (depth === 0) {
      const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)$/);
      if (m) {
        if (m[1] === 'script_class' || m[1] === 'script') continue;
        flush();
        key = m[1];
        buf = [m[2]];
        depth += spanDelta(line);
        continue;
      }
    }
    if (key !== null) buf.push(line);
    depth += spanDelta(line);
  }
  flush();

  return { id, idDeclared, scriptClass, fields, nested };
}

/**
 * Read a record tree: returns { root, families, records, idsByFamily }.
 *
 * A family is a top-level directory under `root` that holds at least one
 * `.tres` (directly or nested). Records carry their family key and a
 * path-relative key so id-less records (e.g. `roots/<name>/environment.tres`)
 * do not collapse onto one another.
 */
// ~2.4KB of live heap per record is measured, not guessed: 400k records peak at 1.27GB
// RSS, 1M at 2.77GB, against Node's ~4.3GB default old-space. Past roughly 1.5M the
// walk dies, and V8's death is SIGABRT (exit 134) after minutes of mark-compact
// thrashing - an exit code this tool's 0/1/2 contract cannot express. The guard turns
// that silent death into a named refusal.
const DEFAULT_RECORD_CEILING = 1500000;

export function readTree(root) {
  const files = walkTres(root);
  // Measured: a record costs ~2.4KB of live heap (fields Map + nested map + the record
  // object). Node's default old-space is ~4.3GB, so the walk dies somewhere past 1.2M
  // records - and V8's death is a SIGABRT (exit 134) after minutes of mark-compact
  // thrashing, which is not an exit code this tool's contract (0/1/2) can express.
  // Refusing up front turns a silent death into a named one. This is a guard against a
  // bad root, not a budget: 1M records is measured to fit and run.
  const ceiling = Number(process.env.TRES_MAX_RECORDS) || DEFAULT_RECORD_CEILING;
  if (files.length > ceiling) {
    throw new Error(`${files.length} .tres files under ${root} exceeds the ${ceiling}-record in-memory ceiling `
      + `(~2.4KB live heap per record against Node's default heap); raise --max-old-space-size, TRES_MAX_RECORDS, or lint in parts`);
  }
  const records = [];
  const idsByFamily = new Map();
  const schemaByFamily = new Map();
  const schemasByFamily = new Map();
  const dirsByFamily = new Map();

  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const family = rel.split('/')[0];
    const { id, idDeclared, scriptClass, fields, nested, unparseable } = parseTres(file);
    // The key is how a record is looked up in `byFamily`. A DECLARED id is unique or
    // the tree is refused (`duplicate-record-id`), so the id alone keys it. An id-less
    // record's stem is NOT unique - `roots/a/environment.tres` and
    // `roots/b/environment.tres` share one - so those key by path, which is the
    // "fixed by path-keying" the spec claims (section 2) and what keeps two of them
    // two records instead of one shadowing the other.
    const key = idDeclared ? id : rel;
    records.push({ file: rel, family, id, idDeclared, key, scriptClass, fields, nested, unparseable });
    // An unparseable record contributes no id: it is not a resolvable target, and
    // letting its stem into the pool would let a dangling ref resolve against a file
    // nobody can read.
    if (!unparseable) {
      if (!idsByFamily.has(family)) idsByFamily.set(family, new Set());
      idsByFamily.get(family).add(id);
    }
    if (scriptClass && !schemaByFamily.has(family)) schemaByFamily.set(family, scriptClass);
    if (scriptClass) {
      if (!schemasByFamily.has(family)) schemasByFamily.set(family, new Set());
      schemasByFamily.get(family).add(scriptClass);
    }
    if (!dirsByFamily.has(family)) dirsByFamily.set(family, new Set());
    dirsByFamily.get(family).add(rel.split('/').slice(0, -1).join('/'));
  }

  // Families come from the DIRECTORIES that hold records, not from the id pool: an
  // unparseable record contributes no id, and a family whose only record is
  // unparseable must still be a family - otherwise it vanishes from the tree and
  // reports as `name-dir-mismatch`, blaming the declaration for a bad file.
  const families = [...dirsByFamily.keys()].sort().map((key) => ({
    key,
    schema: schemaByFamily.get(key) || '',
    count: idsByFamily.get(key)?.size || 0,
    schemas: [...(schemasByFamily.get(key) || [])].sort(),
    dirs: [...(dirsByFamily.get(key) || [])].sort(),
  }));

  return { root, families, records, idsByFamily };
}

/**
 * Why a root is probably not the contract root (SPEC section 1), or null.
 *
 * The contract root is "the directory whose children are family directories". Two
 * mistakes read as a plausible tree and silently produce a useless graph:
 *
 *   - one level TOO HIGH: every record lands in one family (a project root above
 *     `game/data/`), so no edge can resolve. 0 edges, exit 0.
 *   - one level TOO LOW: a family directory is passed as the root, so every `.tres`
 *     becomes its own family and the declaration is nonsense.
 *
 * Both are refused rather than guessed at. The walker cannot know which directory the
 * author meant, and guessing is the brittle frame this standard exists to end. Returns
 * { code, detail, hints } where hints name directories that do read as tree roots.
 */
export function rootProblem(tree, root) {
  const { families, records } = tree;

  if (!records.length) {
    return {
      code: 'empty-tree',
      detail: `no .tres files under ${root} - nothing to check`,
      hints: [],
    };
  }

  // A family key carrying a `.tres` suffix means the root IS a family directory: its
  // children are records, not families.
  const fileKeys = families.filter((f) => f.key.endsWith('.tres'));
  if (fileKeys.length) {
    return {
      code: 'not-a-tree-root',
      detail: `the root's children are records, not families (${fileKeys.length} family key(s) end in .tres) - pass the directory whose children are family directories`,
      hints: [dirname(root)],
    };
  }

  // One family spanning several directories AND several schemas is a directory ABOVE
  // the tree root: the real families are inside it. A mixed family is legal (SPEC
  // section 2 - the reference tree's `balance/` holds ten schemas), so both conditions
  // are required before this fires.
  const collapsed = families.filter((f) => f.schemas.length > 1 && f.dirs.length > 1);
  if (collapsed.length) {
    const worst = collapsed.sort((a, b) => b.count - a.count)[0];
    const inside = [...new Set(worst.dirs.map((d) => d.split('/')[1]).filter(Boolean))].sort();
    return {
      code: 'not-a-tree-root',
      detail: `family ${JSON.stringify(worst.key)} holds ${worst.count} records across ${worst.dirs.length} directories and ${worst.schemas.length} schemas - the root is above the tree root, so no edge can resolve`,
      hints: inside.length ? inside.map((d) => join(root, worst.key, d)) : [join(root, worst.key)],
    };
  }

  return null;
}

/** A hint is only useful if it actually reads as a tree root. */
export function looksLikeTreeRoot(dir) {
  try {
    if (!walkTres(dir).length) return false;
    return rootProblem(readTree(dir), dir) === null;
  } catch { return false; }
}
