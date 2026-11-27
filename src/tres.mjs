// The .tres tree reader: walk a record tree into families and records.
// Host-neutral: it knows nothing about any particular game's vocabulary.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { join, basename, relative, dirname, isAbsolute } from 'node:path';

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
  const s = String(raw);
  // A scanner, not a line matcher. Reading one line at a time only ever saw a key that
  // STARTED a line, so `entries = [{ "item_id": "x" }]` - the same dict Godot writes on
  // one line when it is short - yielded no keys at all. A declared `nested` edge then
  // found no values and reported clean, which is the silent pass this standard exists
  // to end. Depth counts braces only (the array wrapper is not a dict level), matching
  // the shape the corpus uses: `entries[].item_id` is one level in.
  let i = 0;
  let depth = 0;
  const readString = (from) => {
    let k = from + 1;
    while (k < s.length) {
      if (s[k] === '\\') { k += 2; continue; }
      if (s[k] === '"') return k + 1;
      k++;
    }
    return s.length;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      const strEnd = readString(i);
      if (depth === 1) {
        let j = strEnd;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === ':') {
          const key = s.slice(i + 1, strEnd - 1);
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
            // The value runs to the next depth-0 comma, or to the brace that closes
            // the enclosing dict - whichever comes first.
            let k = j + 1;
            let inner = 0;
            while (k < s.length) {
              const ch = s[k];
              if (ch === '"') { k = readString(k); continue; }
              if (ch === '{' || ch === '[') inner++;
              else if (ch === '}' || ch === ']') {
                if (inner === 0) break;
                inner--;
              } else if (ch === ',' && inner === 0) break;
              k++;
            }
            const arr = out.get(key) || [];
            arr.push(s.slice(j + 1, k).trim());
            out.set(key, arr);
            i = k;
            continue;
          }
        }
      }
      i = strEnd;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
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
// Heap cost per record, and per source byte, fitted by least squares to three measured
// corpora: 200k of the smallest plausible records (46B each), 200k of large ones (7.6KB
// each), and 743k typical synmergia-shaped ones. Fit error was -4.6%, -0.0% and +0.1%.
// Two terms are needed because per-record overhead dominates for small records (46B
// records cost 24x their bytes) while field data dominates for large ones.
//
// Predicting up front is what makes the refusal cheap: by the time a tree is deep into
// mark-compact thrashing, a sampling guard takes minutes to notice.
const HEAP_PER_RECORD = 900;
const HEAP_PER_SOURCE_BYTE = 3.3;

/**
 * Estimated live heap a tree will occupy once read, in bytes. Exported so the fit can be
 * checked against measured corpora rather than trusted.
 */
export function estimateHeap(recordCount, sourceBytes) {
  return recordCount * HEAP_PER_RECORD + sourceBytes * HEAP_PER_SOURCE_BYTE;
}

/**
 * The built-in reader. A reader is `{ name, ext, walk(root), parse(file) }`, where
 * `walk` returns absolute record paths and `parse` returns
 * `{ id, idDeclared, scriptClass, fields, nested, unparseable }` with `fields` and
 * `nested` as Maps. Everything above this layer - families, ids, edges, the rules - is
 * format-independent, so a host with its own record format supplies a reader instead of
 * converting its tree to `.tres` first (and linting a copy that can drift from the real
 * records).
 *
 * Exported as an object rather than left implicit so `--reader` has something to fall
 * back to, and so the contract is readable in one place.
 */
export const tresReader = {
  name: '.tres',
  ext: '.tres',
  walk: walkTres,
  parse: parseTres,
};

/** Why a `--reader` module is not usable as a reader, or null. */
export function readerProblem(mod) {
  const r = mod?.reader || mod?.default;
  if (!r || typeof r !== 'object') return 'must export a `reader` object (or a default object)';
  if (typeof r.walk !== 'function') return '`reader.walk(root)` must be a function';
  if (typeof r.parse !== 'function') return '`reader.parse(file)` must be a function';
  return null;
}

/**
 * The record suffix a reader names, normalized to `.ext`.
 *
 * A reader carries both `name` (a label, which may be prose) and `ext` (the suffix).
 * Every consumer that compares a filename to the format needs ONE spelling, so it is
 * resolved here instead of in each rule. Returns '' when the reader names neither,
 * which means "unknown format" and is answered by stripping the last extension.
 */
export function suffixOf(reader) {
  const raw = reader?.ext || (reader?.name && !/\s/.test(reader.name) ? reader.name : '');
  if (!raw) return '';
  return raw.startsWith('.') ? raw : `.${raw}`;
}

const isMap = (v) => v instanceof Map;
const shapeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Why a `parse()` result is not a record, or null if it is.
 *
 * The contract is `{ id, fields: Map, nested: Map }`, and a reader that returns
 * anything else used to fail deep inside a rule: a plain object for `fields` produced
 * `r.fields.keys is not a function`, and a `null` record produced
 * `Cannot read properties of null`. Both are host bugs, so both are named here, at the
 * seam, where the message can say what the reader returned and what it must return.
 */
export function parseProblem(result, file = '(record)') {
  if (!result || typeof result !== 'object') {
    return `reader.parse(${file}) must return a record object, got ${shapeOf(result)}`;
  }
  if (typeof result.id !== 'string' || !result.id) {
    return `reader.parse(${file}) must return a non-empty string \`id\` (got ${JSON.stringify(result.id)})`;
  }
  if (!isMap(result.fields)) {
    return `reader.parse(${file}) must return \`fields\` as a Map (got ${shapeOf(result.fields)})`;
  }
  if (result.nested !== undefined && result.nested !== null && !isMap(result.nested)) {
    return `reader.parse(${file}) must return \`nested\` as a Map or omit it (got ${shapeOf(result.nested)})`;
  }
  return null;
}

/**
 * Why a `walk()` result is not a record list, or null if it is.
 *
 * Every record is keyed by its path RELATIVE to the tree root, and the family is the
 * first path segment - both of which a relative path cannot produce. A reader that
 * returned relative paths used to fail on `stat` with `ENOENT: no such file or
 * directory, stat 'abilities/blueslip.json'`, which reads as a missing file rather
 * than as the contract miss it is.
 */
export function walkProblem(files, root) {
  if (!Array.isArray(files)) return `reader.walk(${root}) must return an array of record paths, got ${shapeOf(files)}`;
  for (const file of files) {
    if (typeof file !== 'string' || !file) return `reader.walk() returned ${JSON.stringify(file)}, which is not a path`;
    if (!isAbsolute(file)) return `reader.walk() must return ABSOLUTE record paths - got ${JSON.stringify(file)}; every record is keyed by its path relative to ${root}`;
  }
  return null;
}

export function readTree(root, opts = {}) {
  const reader = opts.reader || tresReader;
  let files;
  try {
    files = reader.walk(root);
  } catch (err) {
    // The phase is named because a reader may index the tree during `walk` (this one
    // host's reader does), and its error then reads as a tresridge internal with no
    // way to tell where it came from.
    throw new Error(`reader.walk(${root}) failed: ${err.message}`);
  }
  const walkBad = walkProblem(files, root);
  if (walkBad) throw new Error(walkBad);
  const suffix = suffixOf(reader);
  // Refuse before reading, not during: a tree that will not fit is cheapest to reject
  // while nothing has been parsed. The estimate needs the source size, so it costs one
  // stat per file - 2.7s over 743k files, against the ~35s the read itself takes.
  const heapLimit = getHeapStatistics().heap_size_limit;
  // 0.95 rather than 1.0: the model is a fit, not a bound, and the difference between
  // "refused" and "SIGABRT after six minutes" should not rest on a 1% prediction error.
  const budget = heapLimit * 0.95;

  const ceiling = Number(process.env.TRES_MAX_RECORDS) || 0;
  if (ceiling && files.length > ceiling) {
    throw new Error(`${files.length} ${reader.name} files under ${root} exceeds the ${ceiling}-record ceiling (TRES_MAX_RECORDS)`);
  }

  let sourceBytes = 0;
  for (const file of files) {
    try {
      sourceBytes += statSync(file).size;
    } catch {
      // A path that does not stat is a `walk` that named a file it does not have -
      // the contract miss, not a missing record. One stat per file, as before.
      throw new Error(`reader.walk() named ${file}, which does not exist`);
    }
  }
  const predicted = estimateHeap(files.length, sourceBytes);
  if (predicted > budget) {
    throw new Error(`${files.length} ${reader.name} files under ${root} hold ${Math.round(sourceBytes / 1048576)}MB of source, `
      + `which this tool reads into about ${Math.round(predicted / 1048576)}MB of heap; the limit here is ${Math.round(heapLimit / 1048576)}MB. `
      + `Raise --max-old-space-size, or lint the tree in parts`);
  }
  const records = [];
  const idsByFamily = new Map();
  const schemaByFamily = new Map();
  const schemasByFamily = new Map();
  const dirsByFamily = new Map();

  const parseFailures = [];
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const family = rel.split('/')[0];
    let parsed;
    try {
      parsed = reader.parse(file);
    } catch (err) {
      // A reader that throws is not a clean run: the record is unreadable, which is
      // exactly what `unparseable-record` exists to name. Carrying the message on the
      // record keeps the file in the finding - the thrown error alone named no file,
      // so a single malformed record reported a JSON position and nothing to open.
      parseFailures.push({ file: rel, message: err.message });
      parsed = {
        id: basename(file).replace(/\.[^./]+$/, ''),
        idDeclared: false,
        scriptClass: '',
        fields: new Map(),
        nested: new Map(),
        unparseable: `the reader could not parse it: ${err.message}`,
      };
    }
    const parseBad = parseProblem(parsed, rel);
    if (parseBad) throw new Error(parseBad);
    const { id, idDeclared, scriptClass, fields, nested, unparseable } = parsed;
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

  // Every record failing is the reader, not the tree: reporting N identical
  // `unparseable-record` findings over a broken reader buries the one fact that
  // matters, so it is refused once, by name.
  if (parseFailures.length && parseFailures.length === files.length) {
    throw new Error(`reader.parse() failed for all ${files.length} record(s), so the reader is the likely cause. `
      + `First: ${parseFailures[0].file}: ${parseFailures[0].message}`);
  }

  return { root, families, records, idsByFamily, reader: reader.name, suffix };
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
      detail: `no ${tree.reader || '.tres'} records under ${root} - nothing to check`,
      hints: [],
    };
  }

  // A family key carrying a record suffix means the root IS a family directory: its
  // children are records, not families. The suffix comes from `tree.suffix`, which is
  // the reader's EXT - `reader.name` is a label, and a label like "json records" made
  // this guard compare every family against a string no filename ends in, so a root
  // one level too low read as a plausible tree.
  const ext = tree.suffix || '';
  const fileKeys = ext ? families.filter((f) => f.key.endsWith(ext)) : [];
  if (fileKeys.length) {
    return {
      code: 'not-a-tree-root',
      detail: `the root's children are records, not families (${fileKeys.length} family key(s) end in ${ext}) - pass the directory whose children are family directories`,
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
