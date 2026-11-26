// The graph inference: derive a first-draft declaration from a tree.
//
// SPEC section 6: this is INFERENCE, not the contract. It exists so a host
// can start from truth instead of a blank page. The output is a DRAFT for a
// human (or an agent) to accept or correct; the lint never calls this.

import { readTree } from './tres.mjs';
import { quotedValues } from './rules.mjs';

/** The resolution rule: last family token in the field name, pluralised. */
/**
 * The quoted values a candidate field carries, for the widened-residue scan.
 *
 * A top-level field reads its own raw text; a nested path (`edges.to`) reads the
 * level-1 inner key. Values are read with the same `quotedValues` reader the lint
 * uses, so "looks like an id" means the same thing to both.
 */
function edgeValuesOf(record, field) {
  const parts = field.split('.');
  if (parts.length === 2) {
    const inner = record.nested?.get(parts[0]);
    const raw = inner ? inner.get(parts[1]) || [] : [];
    // A value that opens an array/dict is a CONTAINER, not a reference: its quoted
    // keys (`template_id`, `count`) are structure, and reading them as candidate ids
    // invents a probable row for a field that holds no reference at this depth.
    // Measured on `hordes.waves.spawns`, whose real reference sits one level deeper
    // (`waves[].spawns[].template_id`) - beyond the one-level shape this standard
    // reads. Top-level containers are already skipped by the caller; the nested
    // level needs the same guard.
    return raw.flatMap((r) => (/^\s*[[{]/.test(r) ? [] : quotedValues(r)));
  }
  const raw = record.fields.get(field);
  return raw === undefined ? [] : quotedValues(raw);
}

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

  // Every id the tree carries, per family. A field that names no family token and
  // carries no `_id` suffix is invisible to `targetFor`, but its VALUES can still be
  // ids that live in a sibling family - which is what a reference looks like when the
  // host named it `to`, `related`, or `cites` (issue #22). This pool is what lets the
  // on-ramp say "these look like references" instead of "0 edges, nothing to declare".
  const idPool = new Map();
  for (const r of tree.records) {
    if (r.unparseable) continue;
    if (!idPool.has(r.family)) idPool.set(r.family, new Set());
    idPool.get(r.family).add(r.id);
  }
  const probable = new Map();

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

    // Widened residue: a field the naming rule cannot see, but whose values ARE ids
    // from another family. Reported as `probable`, never as an edge - inference is
    // not the contract (SPEC section 5), so a guess must never become a declaration
    // row. It only has to be VISIBLE, so the on-ramp is not a blank page.
    //
    // The row carries its own EVIDENCE (`distinct`, `matched`, `ratio`) rather than a
    // bare count, because a bare count cannot be audited. Both sides are counted over
    // the field's DISTINCT values: counting occurrences on one side and distinct values
    // on the other produced a ratio of 2.00 (measured on `balance.items_by_role`),
    // which is not a share of anything. Measured on the reference deployment, real
    // references score 0.79-1.00 (required_class 18/18, unlocks 214/214) and a
    // coincidence scores 0.15 (dialogues.nodes.choices: 16 of 108 values).
    for (const { field, nested } of candidates) {
      const leaf = field.split('.').pop();
      if (/_ids?$/.test(leaf)) continue; // already handled above
      // A TOP-LEVEL `id` is the record's own identity (SPEC section 3: the filename is
      // the id), never a reference. Two families holding the same id is a normal
      // collision, and reporting it invents 6 references on the reference deployment.
      // A NESTED `id` (`rewards[].id`) is a different thing and stays a candidate.
      if (!nested && field === 'id') continue;
      // A top-level field holding an array-of-dicts is the CONTAINER, not the
      // reference: its inner keys are the candidates. Reporting both names one
      // reference twice and doubles the count a human reads.
      if (!nested && r.nested?.has(field)) continue;
      const values = edgeValuesOf(r, field);
      if (!values.length) continue;
      const id = `${r.family}.${field}`;
      if (!probable.has(id)) probable.set(id, { values: new Set(), matched: new Set(), targets: new Set() });
      const acc = probable.get(id);
      for (const v of values) {
        if (!v) continue;
        acc.values.add(v);
        for (const [fam, pool] of idPool) {
          if (fam === r.family) continue;
          if (pool.has(v)) { acc.matched.add(v); acc.targets.add(fam); break; }
        }
      }
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

    // Fields whose values look like ids from another family, but whose NAME gives the
    // rule nothing to key on. A human decides whether these are edges (`ref`/`refs`/
    // `nested`) or `literal`; nothing here is auto-declared.
    probable: [...probable.entries()].filter(([, v]) => v.matched.size > 0).map(([k, v]) => {
        const i = k.indexOf('.');
        // `ratio` is the share of DISTINCT values that name an id elsewhere. It is the
        // number a human can audit: 1.00 means every value is somebody's id, 0.04 means
        // one value coincidentally matches. Sorted by matched DESC, then ratio DESC, so
        // the strongest evidence is read first.
        const distinct = v.values.size;
        const matched = v.matched.size;
        return {
          family: k.slice(0, i), field: k.slice(i + 1),
          count: matched, distinct,
          ratio: distinct ? Math.round((matched / distinct) * 100) / 100 : 0,
          targets: [...v.targets].sort(),
        };
    }).sort((a, b) => b.count - a.count || b.ratio - a.ratio),
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
export function diffDeclaration(inferred, declared, residue = { undeclared: [], probable: [] }) {
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
  // A residue field is one inference could not resolve; a human declared it. Its
  // presence in the declaration but not the inference is the point, not drift. The same
  // holds for a `probable` field: inference offered the evidence and deliberately
  // declined to declare, so the human's declaration is the ANSWER, not a removal.
  //
  // The exemption is checked against the evidence, not granted on the field name alone:
  // `probable` said the values live in these families, so a declaration that points
  // elsewhere is drift the gate must still report. Blanket-exempting by name let
  // `npcs.parent_zone -> npcs` pass while the evidence said `zones`.
  const undeclaredKeys = new Set((residue.undeclared || []).map(key));
  const probableByKey = new Map((residue.probable || []).map((r) => [key(r), r]));
  const answersProbable = (e) => {
    const p = probableByKey.get(key(e));
    if (!p || e.kind === 'literal') return false;
    const said = new Set(p.targets || []);
    return [...targets(e)].every((t) => said.has(t));
  };
  for (const e of declared.edges || []) {
    const i = inferredByKey.get(key(e));
    if (!i) {
      if (undeclaredKeys.has(key(e)) || answersProbable(e)) continue;
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
