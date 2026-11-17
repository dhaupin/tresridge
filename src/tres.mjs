// The .tres tree reader: walk a record tree into families and records.
// Host-neutral: it knows nothing about any particular game's vocabulary.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

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

/**
 * Parse one `.tres` file into { id, scriptClass, fields }.
 *
 * `fields` is a Map of field -> raw value text. Godot writes both
 * `key = value` (top level) and `"key": value` (inside dicts); we read
 * top-level assignments only, which is where a record's own fields live.
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
  const fields = new Map();
  for (const m of txt.matchAll(/^\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*[:=]\s*(.+)$/gm)) {
    const key = m[1];
    if (key === 'id' || key === 'script') continue;
    fields.set(key, m[2].trim());
  }
  return { id, idDeclared, scriptClass, fields };
}

/**
 * Read a record tree: returns { root, families, records, idsByFamily }.
 *
 * A family is a top-level directory under `root` that holds at least one
 * `.tres` (directly or nested). Records carry their family key and a
 * path-relative key so id-less records (e.g. `roots/<name>/environment.tres`)
 * do not collapse onto one another.
 */
export function readTree(root) {
  const files = walkTres(root);
  const records = [];
  const idsByFamily = new Map();
  const schemaByFamily = new Map();

  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const family = rel.split('/')[0];
    const { id, idDeclared, scriptClass, fields } = parseTres(file);
    const key = `${family}:${id}`;
    records.push({ file: rel, family, id, idDeclared, key, scriptClass, fields });
    if (!idsByFamily.has(family)) idsByFamily.set(family, new Set());
    idsByFamily.get(family).add(id);
    if (scriptClass && !schemaByFamily.has(family)) schemaByFamily.set(family, scriptClass);
  }

  const families = [...idsByFamily.keys()].sort().map((key) => ({
    key,
    schema: schemaByFamily.get(key) || '',
    count: idsByFamily.get(key).size,
  }));

  return { root, families, records, idsByFamily };
}
