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

      const target = targetFor(leaf, familyKeys);
      if (!target) {
        // Count every record that carries the field, so the residue list says how
        // much work a field is, not just that it exists. Deduping before counting
        // made `count` always 1.
        undeclared.set(id, (undeclared.get(id) || 0) + 1);
        continue;
      }
      // Edges are declared once per (family, field): the first record that resolves
      // the field defines the row.
      if (seen.has(id)) continue;
      seen.add(id);
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

/**
 * Infer from an ALREADY-read tree.
 *
 * The CLI reads the tree once (it has to, to hold the root to the contract root
 * before any verb runs) and then infers from it. Re-reading would walk the corpus
 * twice and could disagree with the tree the root was checked against.
 */
export function inferFrom(tree) {
  return inferDeclaration(tree);
}

/**
 * Diff an inferred graph against a committed declaration - the drift gate.
 *
 * A declaration that has fallen behind the corpus is loud, not silent: a new
 * edge in the tree that no row names, or a row naming an edge the tree no
 * longer has, is a drift. Returns { added, removed, changed } keyed by
 * `family.field`.
 *
 * Only RESOLVING edges are compared. Residue fields are, by definition, ones
 * inference could not resolve - a human declared them - so their presence in
 * the declaration but not the inference is expected, not drift.
 *
 * A row that exists on both sides but points somewhere else is ALSO drift
 * (`changed`). Comparing only the key was a hole: a declaration could retarget
 * `npcs.zone_id` at `worlds` - the exact mistake the lint would then enforce -
 * and the gate reported "0 added, 0 removed". A target is compared as a SET,
 * because widening an edge to a union (ids living across several families) is a
 * legitimate human refinement; a union that CONTAINS the inferred target agrees
 * with inference, and one that omits it does not.
 */
export function diffDeclaration(inferred, declared, residue = { undeclared: [] }) {
  const key = (e) => `${e.family}.${String(e.field).replace(/\[\]/g, '')}`;
  const targets = (e) => new Set(Array.isArray(e.target) ? e.target : [e.target]);
  const seen = new Map((declared.edges || []).map((e) => [key(e), e]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const e of inferred.edges || []) {
    if (!seen.has(key(e))) added.push({ family: e.family, field: e.field, target: e.target, kind: e.kind });
  }
  const inferredByKey = new Map((inferred.edges || []).map((e) => [key(e), e]));
  // A residue field is one inference could not resolve; a human declared it.
  // Its presence in the declaration but not the inference is the point, not drift.
  const residueKeys = new Set((residue.undeclared || []).map(key));
  for (const e of declared.edges || []) {
    const i = inferredByKey.get(key(e));
    if (!i) {
      if (residueKeys.has(key(e))) continue;
      // A `literal` row is a human decision about a non-reference; inference never
      // produces one, so it is never drift.
      if (e.kind === 'literal') continue;
      removed.push({ family: e.family, field: e.field, target: e.target, kind: e.kind });
      continue;
    }
    const want = targets(e);
    const sameTarget = [...targets(i)].every((t) => want.has(t));
    if (!sameTarget || e.kind !== i.kind) {
      changed.push({
        family: e.family, field: e.field,
        declared: { target: e.target, kind: e.kind },
        inferred: { target: i.target, kind: i.kind },
      });
    }
  }
  return { added, removed, changed };
}
