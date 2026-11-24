// src/packs.mjs - the pack loader: manifest validation, source resolution
// (local paths AND npm packages), relevance skipping, and the id-collision
// refusal. One place the CLI (`--packs`), the campaign runner
// (scripts/run-packs.mjs), and any embedding consumer share, so a pack is
// validated the same way wherever it is armed.
//
// packstruct SPEC v1 (sections 2/4/5): a pack dir carries pack.json with
// schemaVersion 1, a kebab-case name matching its directory, dotted version, a
// non-empty description, and an `entry` that is a relative path inside the pack
// dir. Every refusal is instant, one-line, and names the pack - never a deep
// stack trace, never silent success.
//
// tresridge is a `check`-profile host (SPEC section 3): a pack's default export
// carries `checks[]`, and each check is a RULE - the same shape the in-repo
// registry holds, so a pack rule and a core rule run through one pipeline and
// one vocabulary. A pack also carries its own vocabulary (`vocabulary` key,
// host-owned), which the loader merges before any rule is judged: a pack may not
// invent a code, so a check naming a code its own vocabulary does not carry is
// refused (`unknown-rule`), exactly as a host `--rules` module would be.
//
// Sources (SPEC section 4: explicit loads only, no auto-download):
//   - a local path: './packs/godot-shapes' or 'packs/godot-shapes'
//   - an npm package: '@synmergia/godot-shapes' or 'godot-shapes', resolved from
//     the nearest node_modules that carries it. If it is not installed the load
//     REFUSES with the fix named - it never fetches.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PACK_SCHEMA_VERSION = 1;

const RE_KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

// A pack spec is an npm name when it has no path shape (no leading '.', '/', or
// '~', and no slash-separated directory that exists relative to cwd). Scoped
// names ('@scope/name') are npm; a bare 'packs/foo' is a path.
export function isNpmSpec(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~')) return false;
  if (spec.startsWith('@')) return true;
  return !spec.includes('/');
}

// Resolve one pack spec to an absolute pack dir. Local: relative to cwd.
// npm: walk up from cwd for node_modules/<name> that carries a pack.json.
// Never downloads - an uninstalled npm pack refuses with the fix named.
export function resolvePackSpec(spec, cwd = process.cwd()) {
  if (isNpmSpec(spec)) {
    const found = resolveInstalled(spec, cwd);
    if (!found) throw new Error(`pack "${spec}" is not installed - fix: npm i -D ${spec} (the loader never downloads a pack)`);
    return { dir: found, source: `npm:${spec}` };
  }
  const dir = resolve(cwd, spec);
  if (!existsSync(dir)) throw new Error(`pack path "${spec}" does not exist (resolved to ${dir})`);
  return { dir, source: `path:${spec}` };
}

function resolveInstalled(name, cwd) {
  let dir = resolve(cwd);
  const { root } = parse(dir);
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'pack.json'))) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

// Validate a manifest against SPEC v1. `dirName` is the pack directory's
// basename; the spec requires the manifest name to match it. Throws a nameable,
// one-line error - the caller's job is only to let it surface.
//
// `requires` is shape-checked and assigned no meaning here (SPEC section 2,
// v1.3.0): it is compared against the run root's `provides` in `isRelevant`.
export function validateManifest(spec, dirName, source) {
  const where = source ? `${source} (${dirName})` : dirName;
  if (!spec || typeof spec !== 'object') throw new Error(`pack ${where}: pack.json is not an object`);
  if (typeof spec.name !== 'string' || !RE_KEBAB.test(spec.name)) {
    throw new Error(`pack ${where}: manifest "name" must be a kebab-case string (got ${JSON.stringify(spec.name)})`);
  }
  if (spec.name !== dirName) {
    throw new Error(`pack ${where}: manifest name "${spec.name}" does not match the directory name`);
  }
  if (spec.schemaVersion !== PACK_SCHEMA_VERSION) {
    throw new Error(`pack ${where}: pack.json schemaVersion must be ${PACK_SCHEMA_VERSION} (got ${JSON.stringify(spec.schemaVersion)})`);
  }
  if (typeof spec.version !== 'string' || !RE_SEMVER.test(spec.version)) {
    throw new Error(`pack ${where}: "version" must be dotted semver-ish (got ${JSON.stringify(spec.version)})`);
  }
  if (typeof spec.description !== 'string' || !spec.description.trim()) {
    throw new Error(`pack ${where}: "description" must be a non-empty string`);
  }
  if (typeof spec.entry !== 'string' || !spec.entry
      || isAbsolute(spec.entry) || spec.entry.split('/').includes('..')) {
    throw new Error(`pack ${where}: "entry" must be a relative path inside the pack dir (got ${JSON.stringify(spec.entry)})`);
  }
  if (spec.requires !== undefined) {
    if (!Array.isArray(spec.requires)) {
      throw new Error(`pack ${where}: "requires" must be an array of kebab-case capability tokens (got ${JSON.stringify(spec.requires)})`);
    }
    const seen = new Set();
    for (const t of spec.requires) {
      if (typeof t !== 'string' || !RE_KEBAB.test(t)) {
        throw new Error(`pack ${where}: "requires" token must be kebab-case (got ${JSON.stringify(t)})`);
      }
      if (seen.has(t)) throw new Error(`pack ${where}: "requires" repeats the token "${t}"`);
      seen.add(t);
    }
  }
  if (spec.vocabulary !== undefined && typeof spec.vocabulary !== 'string') {
    throw new Error(`pack ${where}: host-owned "vocabulary" must name a JSON file relative to the pack dir (got ${JSON.stringify(spec.vocabulary)})`);
  }
  return spec;
}

// SPEC section 4, the relevance norm (v1.3.0): a run root declares `provides`
// (what its target offers) and MAY declare `ignore` (a deny-list). A pack whose
// `requires` is not a subset of `provides` skips BEFORE import; `ignore` wins
// over relevance. A root declaring neither loads every pack, byte-identical to
// pre-v1.3.0 behavior. The skip is always reportable - never a silent green.
export function isRelevant(packSpec, root = {}) {
  const name = packSpec?.name;
  const ignore = Array.isArray(root.ignore) ? root.ignore : [];
  if (name && ignore.includes(name)) return { relevant: false, reason: 'ignore', detail: `named in the run root's ignore list` };
  const provides = Array.isArray(root.provides) ? root.provides : [];
  if (provides.length === 0) return { relevant: true };
  const requires = Array.isArray(packSpec?.requires) ? packSpec.requires : [];
  const unmet = requires.filter((t) => !provides.includes(t));
  if (unmet.length) {
    return { relevant: false, reason: 'unmet-requires', detail: `needs ${unmet.map((t) => JSON.stringify(t)).join(', ')}; the run root provides ${provides.map((t) => JSON.stringify(t)).join(', ') || 'nothing'}` };
  }
  return { relevant: true };
}

// Load one pack dir: read + validate the manifest, import the entry, unwrap a
// default export. `source` labels the refusal (a path or npm spec).
export async function loadPackDir(dir, source) {
  const dirName = dir.split('/').pop();
  const manifestPath = join(dir, 'pack.json');
  let spec;
  try {
    spec = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`pack ${source || dirName}: no parseable pack.json (${err.message})`);
  }
  validateManifest(spec, dirName, source);
  const entryAbs = join(dir, spec.entry);
  if (!existsSync(entryAbs)) {
    throw new Error(`pack ${source || dirName}: entry "${spec.entry}" does not exist in the pack dir`);
  }
  let loaded;
  try {
    loaded = await import(pathToFileURL(entryAbs).href);
  } catch (err) {
    throw new Error(`pack ${source || dirName}: entry "${spec.entry}" failed to load: ${err.message}`);
  }
  let module = loaded;
  if (loaded && typeof loaded === 'object' && 'default' in loaded) {
    if (loaded.default == null) throw new Error(`pack ${source || dirName}: entry "${spec.entry}" has a null default export`);
    module = loaded.default;
  }
  return { name: spec.name, spec, module, dir, source: source || dir };
}

// The checks a loaded pack exposes, as rules the lint can run. The `check`
// profile's contract is `{ checks: [...] }`; a rule IS a check here, because
// tresridge's checks and rules are the same shape by construction.
export function checksOf(pack) {
  const list = pack?.module?.checks ?? pack?.module?.rules;
  return Array.isArray(list) ? list : [];
}

// Scan a packs ROOT for pack dirs (the packs/public behavior): every immediate
// subdirectory must declare itself. Sorted for determinism.
export function discoverPackDirs(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    throw new Error(`${root} is not a readable pack tree: ${err.message}`);
  }
  return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name)).sort();
}

// A pack's own vocabulary file, merged into the vocabulary the lint is handed.
// The pack may not invent a code, so this is where its codes become legal.
export function vocabularyOf(pack) {
  const rel = pack?.spec?.vocabulary;
  if (!rel) return [];
  if (isAbsolute(rel) || rel.split('/').includes('..')) {
    throw new Error(`pack ${pack.name}: "vocabulary" must be a relative path inside the pack dir (got ${JSON.stringify(rel)})`);
  }
  const path = join(pack.dir, rel);
  if (!existsSync(path)) throw new Error(`pack ${pack.name}: vocabulary file "${rel}" does not exist in the pack dir`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`pack ${pack.name}: vocabulary "${rel}" does not parse (${err.message})`);
  }
  const codes = Array.isArray(parsed) ? parsed : parsed?.codes;
  if (!Array.isArray(codes)) throw new Error(`pack ${pack.name}: vocabulary "${rel}" must be an array or carry a "codes" array`);
  // A vocabulary entry is either a bare code string or a record carrying one
  // (`{code, severity, detail}`) - the shape spec/refusals.json uses.
  return codes.map((c) => (typeof c === 'string' ? c : c?.code)).filter((c) => typeof c === 'string' && c);
}

// The union loader: a packs root (scanned) plus explicit specs (local paths or
// npm names), deduped by pack name. A name collision refuses to start - SPEC
// section 4, never silent dedupe. A pack skipped by relevance is RETURNED as a
// named skip, never dropped silently.
export async function collectPacks({ root, specs = [], cwd = process.cwd(), runRoot = {} } = {}) {
  const dirs = [];
  if (root && existsSync(root)) for (const d of discoverPackDirs(root)) dirs.push({ dir: d, source: null });
  for (const spec of specs) dirs.push(resolvePackSpec(spec, cwd));
  const loaded = [];
  const skipped = [];
  const seen = new Map();
  for (const { dir, source } of dirs) {
    const dirName = dir.split('/').pop();
    const manifestPath = join(dir, 'pack.json');
    let spec;
    try {
      spec = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      throw new Error(`pack ${source || dirName}: no parseable pack.json (${err.message})`);
    }
    validateManifest(spec, dirName, source);
    const relevance = isRelevant(spec, runRoot);
    if (!relevance.relevant) {
      skipped.push({ name: spec.name, reason: relevance.reason, detail: relevance.detail, source: source || dir });
      continue;
    }
    const pack = await loadPackDir(dir, source);
    if (seen.has(pack.name)) {
      throw new Error(`pack name "${pack.name}" collides: ${seen.get(pack.name)} and ${pack.source}`);
    }
    seen.set(pack.name, pack.source);
    loaded.push(pack);
  }
  return { packs: loaded, skipped };
}

// Census the ids a loaded pack declares. Ids are namespaced by the pack slug at
// the host level; this only reports what the entry exposes.
export function censusIds(pack) {
  const out = [];
  for (const item of checksOf(pack)) {
    // `id` first: it is the key packstruct's own census reads, so a pack that
    // carries both keys is counted the way the ecosystem counts it.
    const id = typeof item === 'string' ? item : item?.id ?? item?.code ?? item?.name;
    if (typeof id === 'string' && id) out.push(id);
  }
  return out;
}
