// The graph inference: derive a first-draft declaration from a tree.
//
// SPEC section 6: this is INFERENCE, not the contract. It exists so a host
// can start from truth instead of a blank page. The output is a DRAFT for a
// human (or an agent) to accept or correct; the lint never calls this.

import { readTree } from './tres.mjs';

/** The resolution rule: last family token in the field name, pluralised. */
export function targetFor(field, familyKeys) {
  const base = field.replace(/_ids?$/, '');
  const tokens = base.split('_');
  const candidates = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    candidates.push(tokens.slice(i).join('_'));
    candidates.push(tokens[i]);
  }
  for (const c of candidates) {
    for (const plural of [c, c + 's', c.replace(/y$/, 'ies')]) {
      if (familyKeys.has(plural)) return plural;
    }
  }
  return null;
}

/**
 * Infer a draft declaration from a tree.
 *
 * Returns { declaration, residue }:
 *   declaration - { schemaVersion, families, edges } ready to hand-edit
 *   residue     - { undeclared: [{family, field, count}], dangling: [...] }
 *                 the fields the rule could NOT resolve; each needs a human call.
 */
export function inferDeclaration(tree) {
  const familyKeys = new Set(tree.families.map((f) => f.key));

  // A family declares a schema only when ALL its records share one. A mixed
  // family (`balance/`) declares none - the record's own schema stands.
  const schemaCounts = new Map();
  for (const r of tree.records) {
    if (!r.scriptClass) continue;
    if (!schemaCounts.has(r.family)) schemaCounts.set(r.family, new Map());
    const m = schemaCounts.get(r.family);
    m.set(r.scriptClass, (m.get(r.scriptClass) || 0) + 1);
  }
  const families = tree.families.map((f) => {
    const schemas = schemaCounts.get(f.key);
    const uniform = schemas && schemas.size === 1 ? [...schemas.keys()][0] : '';
    return { key: f.key, schema: uniform, idPrefix: inferPrefix(tree, f.key) };
  });

  const edges = [];
  const seen = new Set();
  const undeclared = new Map();

  for (const r of tree.records) {
    // Top-level fields, then level-1 nested keys (`entries.item_id`). The nested
    // path IS the field, and the kind is `nested`; the target comes from the
    // inner key's family token, not the outer field's.
    const candidates = [];
    for (const [field, raw] of r.fields) candidates.push({ field, nested: false });
    for (const [outer, inner] of r.nested || []) {
      for (const key of inner.keys()) candidates.push({ field: `${outer}.${key}`, nested: true });
    }
    for (const { field, nested } of candidates) {
      const leaf = field.split('.').pop();
      if (!/_ids?$/.test(leaf)) continue;
      if (!/[a-z]/.test(leaf)) continue;
      const kind = nested ? 'nested' : (leaf.endsWith('_ids') ? 'refs' : 'ref');
      const id = `${r.family}.${field}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const target = targetFor(leaf, familyKeys);
      if (!target) {
        undeclared.set(id, (undeclared.get(id) || 0) + 1);
        continue;
      }
      edges.push({ family: r.family, field, target, kind, required: true });
    }
  }

  edges.sort((a, b) => (a.family + a.field).localeCompare(b.family + b.field));

  const declaration = { schemaVersion: 1, families, edges };
  const residue = {
    undeclared: [...undeclared.entries()].map(([k, count]) => {
        // Split on the FIRST dot only: a nested path is `family.outer.inner`, and
        // dropping the inner key made the residue under-report.
        const i = k.indexOf('.');
        return { family: k.slice(0, i), field: k.slice(i + 1), count };
    }).sort((a, b) => b.count - a.count),
  };
  return { declaration, residue };
}

/**
 * Infer a family's idPrefix from its records: the stem's common prefix beyond the
 * declared id. `achievement_bloom_contained.tres` (id `bloom_contained`) implies
 * prefix `achievement_`. Returns '' when no record declares an id or none agree.
 */
function inferPrefix(tree, family) {
  let prefix = null;
  for (const r of tree.records) {
    if (r.family !== family || !r.idDeclared) continue;
    const stem = r.file.split('/').pop().replace(/\.tres$/, '');
    if (!stem.endsWith(r.id)) return '';
    const p = stem.slice(0, stem.length - r.id.length);
    if (prefix === null) prefix = p;
    else if (prefix !== p) return '';
  }
  return prefix || '';
}

/** Read a tree and infer in one call. */
export function graph(root) {
  const tree = readTree(root);
  const { declaration, residue } = inferDeclaration(tree);
  return { tree, declaration, residue };
}
