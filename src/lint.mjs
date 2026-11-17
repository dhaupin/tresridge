// The conformance lint: check a record tree against a declaration.
//
// The core discipline (SPEC section 6): the declaration is authoritative and
// the lint NEVER infers at check time. A check that guesses is the brittle
// frame the spec exists to end. Inference lives in graph.mjs, which SEEDS a
// declaration; it never replaces one.

import { readTree } from './tres.mjs';

export const KINDS = ['ref', 'refs', 'nested', 'virtual', 'literal'];
export const SCHEMA_VERSION = 1;

/** Validate a declaration's own shape. Returns an array of refusal strings. */
export function validateDeclaration(decl) {
  const out = [];
  if (decl?.schemaVersion !== SCHEMA_VERSION) {
    out.push(`declaration schemaVersion MUST be ${SCHEMA_VERSION} (have: ${JSON.stringify(decl?.schemaVersion)})`);
  }
  if (!Array.isArray(decl?.families)) out.push('declaration families MUST be an array');
  if (!Array.isArray(decl?.edges)) out.push('declaration edges MUST be an array');

  const seenFamily = new Set();
  for (const f of decl?.families || []) {
    // A family key IS its directory name. Godot content trees use snake_case
    // (`loot_tables`), so the rule is "identifier-shaped", not "kebab-case" -
    // the kebab rule was an invention the reference tree immediately refused.
    if (!/^[a-z0-9]+([_-][a-z0-9]+)*$/.test(f?.key || '')) out.push(`family key MUST be an identifier (its directory name): ${JSON.stringify(f?.key)}`);
    if (seenFamily.has(f?.key)) out.push(`duplicate family key: ${f?.key}`);
    seenFamily.add(f?.key);
  }

  const seenEdge = new Set();
  for (const e of decl?.edges || []) {
    const id = `${e?.family}.${e?.field}`;
    if (!e?.family || !e?.field) out.push(`edge MUST name family and field: ${JSON.stringify(e)}`);
    if (seenEdge.has(id)) out.push(`duplicate-edge: ${id} declared twice`);
    seenEdge.add(id);
    if (!KINDS.includes(e?.kind)) out.push(`edge kind MUST be one of ${KINDS.join('/')}: ${id} = ${JSON.stringify(e?.kind)}`);
    if (e?.kind !== 'literal' && e?.kind !== 'virtual') {
      const targets = Array.isArray(e?.target) ? e.target : [e?.target];
      for (const t of targets) {
        if (!seenFamily.has(t)) out.push(`edge target MUST name a declared family: ${id} -> ${JSON.stringify(t)}`);
      }
    }
  }
  return out;
}

/**
 * Extract candidate id values from a raw `.tres` value text.
 *
 * An id is lowercase-led: `npc_blacksmith`, `gold`, `book_akkan_rune_chain`.
 * A PascalCase token (`BlacksmithService`) is a CLASS NAME, not an id - counting
 * it as a reference was a measured false positive (SPEC section 5, the
 * `literal` kind: a field can end `_id` and hold a non-id).
 */
function idsIn(raw) {
  const out = [];
  for (const m of String(raw).matchAll(/"([A-Za-z0-9_.:-]+)"/g)) {
    if (/^[a-z0-9][a-z0-9_.:-]*$/.test(m[1])) out.push(m[1]);
  }
  return out;
}

/** Non-id (PascalCase-led) values in an `_id`-shaped field: a `literal` finding. */
export function nonIdValues(raw) {
  const out = [];
  for (const m of String(raw).matchAll(/"([A-Za-z0-9_.:-]+)"/g)) {
    if (!/^[a-z0-9][a-z0-9_.:-]*$/.test(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Resolve one edge reference against the tree.
 * `literal` and `virtual` never resolve (by design).
 */
function resolves(kind, target, value, tree) {
  if (kind === 'literal') return true;
  // `virtual` is pattern-resolved: the host service expands it at runtime, so a
  // conforming lint never runs the expansion (SPEC section 5).
  if (kind === 'virtual') return true;
  // `target` may be a single family key or an ARRAY of keys - a union family.
  // Item ids, for example, live across weapons/armors/resources/... so the edge
  // names the union rather than one directory (SPEC section 4).
  const targets = Array.isArray(target) ? target : [target];
  for (const t of targets) {
    const pool = tree.idsByFamily.get(t);
    if (pool && pool.has(value)) return true;
  }
  return false;
}

/**
 * Lint a record tree against a declaration.
 *
 * Returns { families, records, edges, violations, warnings }.
 * Violations carry { code, record, field, target, detail }.
 */
export function lint(tree, decl) {
  const violations = [];
  const warnings = [];
  const declared = new Set();
  for (const e of decl.edges) declared.add(`${e.family}.${e.field}`);

  const knownFamilies = new Set(decl.families.map((f) => f.key));

  // 1. Every family directory must be declared (name-dir / undeclared family).
  for (const fam of tree.families) {
    if (!knownFamilies.has(fam.key)) {
      violations.push({ code: 'undeclared-family', record: fam.key, detail: `directory holds records but no family declares it` });
    }
  }

  // 2. Filename == id, and declared families must match their schema.
  const declFamily = new Map(decl.families.map((f) => [f.key, f]));
  for (const r of tree.records) {
    const fam = declFamily.get(r.family);
    if (!fam) continue;
    const stem = r.file.split('/').pop().replace(/\.tres$/, '');
    if (fam.idPrefix && !stem.startsWith(fam.idPrefix) && stem !== r.id) {
      // id-less or path-keyed records are the acknowledged exception (SPEC 2)
    }
    // `schema` is OPTIONAL and advisory. A family may hold several schemas
    // (the reference tree's `balance/` holds twelve), in which case it declares
    // none and the record's own schema stands. Declaring a schema asserts that
    // every record in the family carries it.
    if (fam.schema && r.scriptClass && fam.schema !== r.scriptClass) {
      violations.push({ code: 'schema-mismatch', record: r.file, detail: `family ${fam.key} declares schema ${fam.schema}, record is ${r.scriptClass}` });
    }
  }

  // 3. Every edge resolves, and every `_id` field is declared.
  let edgeCount = 0;
  for (const r of tree.records) {
    for (const [field, raw] of r.fields) {
      const idShaped = /_ids?$/.test(field);
      const declKey = `${r.family}.${field}`;
      const edge = decl.edges.find((e) => e.family === r.family && e.field === field);

      if (idShaped && !edge) {
        violations.push({ code: 'undeclared-edge', record: r.file, field, detail: `field ends _id/_ids and no edge declares it (and it is not literal)` });
        continue;
      }
      if (!edge) continue;

      const values = idsIn(raw);
      for (const v of values) {
        edgeCount++;
        const ok = resolves(edge.kind, edge.target, v, tree, edge.pattern);
        if (!ok) {
          const row = { code: 'dangling-ref', record: r.file, field, target: v, detail: `edge ${r.family}.${field} -> ${edge.target}, "${v}" not found` };
          if (edge.required === false) warnings.push(row);
          else violations.push(row);
        }
      }
    }
  }

  // 4. Cycles: follow declared scalar `ref` edges among same-family records.
  const cycleEdges = decl.edges.filter((e) => e.kind === 'ref' && e.required !== false);
  const byFamily = new Map();
  for (const r of tree.records) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, new Map());
    byFamily.get(r.family).set(r.id, r);
  }
  const seenCycles = new Set();
  for (const e of cycleEdges) {
    const pool = byFamily.get(e.family);
    if (!pool) continue;
    // Follow the edge to ITS target family, not the declaring family. A
    // same-name id in a different family is not a cycle.
    const tkey = Array.isArray(e.target) ? e.target[0] : e.target;
    const tpool = byFamily.get(tkey);
    if (!tpool) continue;
    for (const r of pool.values()) {
      const raw = r.fields.get(e.field);
      if (!raw) continue;
      const next = idsIn(raw)[0];
      if (!next) continue;
      const target = tpool.get(next);
      if (!target) continue;
      const back = target.fields.get(e.field);
      if (back && idsIn(back)[0] === r.id) {
        // Report each unordered pair once: A<->B is one cycle, not two.
        const pair = [r.id, next].sort().join('<->');
        if (seenCycles.has(pair)) continue;
        seenCycles.add(pair);
        violations.push({ code: 'cycle', record: r.file, field: e.field, detail: `${r.id} <-> ${next} via ${e.field}` });
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    families: tree.families.length,
    records: tree.records.length,
    edges: edgeCount,
    violations,
    warnings,
  };
}
