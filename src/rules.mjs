// The rule registry - the enforcement spine.
//
// Every refusal a conforming lint can emit is ONE entry here, carrying its code,
// its default severity, its scope, and its check. The lint is a pipeline over this
// registry; it holds no refusals of its own. That is the whole point: a rule cannot
// exist in the code without existing in the vocabulary, and the drift gate
// (`scripts/check-vocabulary.mjs`) refuses when `spec/refusals.json` and this
// registry disagree in either direction. SPEC section 7's table is generated from
// the vocabulary, so the prose, the registry, and the battery are one source.
//
// A host extends by ADDING rules, never by editing these: pass `extraRules` to
// `lint()` (the CLI's `--rules <module>`), each shaped like an entry here. An extra
// rule whose code the vocabulary does not name is itself refused (`unknown-rule`).

export const KINDS = ['ref', 'refs', 'nested', 'virtual', 'literal'];
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared value readers (used by rules, the generator, and the CLI).
// ---------------------------------------------------------------------------

/**
 * Extract candidate id values from a raw `.tres` value text.
 *
 * An id is lowercase-led: `npc_blacksmith`, `gold`, `book_akkan_rune_chain`.
 * A PascalCase token (`BlacksmithService`) is a CLASS NAME, not an id - counting
 * it as a reference was a measured false positive (SPEC section 5, the `literal`
 * kind: a field can end `_id` and hold a non-id).
 */
export function idsIn(raw) {
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
export function resolves(kind, target, value, tree) {
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

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Build the read-only context every rule receives. */
export function buildContext(tree, decl) {
  const declared = new Set();
  for (const e of decl.edges) declared.add(`${e.family}.${e.field}`);
  const knownFamilies = new Set(decl.families.map((f) => f.key));
  const declFamily = new Map(decl.families.map((f) => [f.key, f]));
  const byFamily = new Map();
  for (const r of tree.records) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, new Map());
    byFamily.get(r.family).set(r.id, r);
  }
  const edgeOf = new Map();
  for (const e of decl.edges) edgeOf.set(`${e.family}.${e.field}`, e);
  return { tree, decl, declared, knownFamilies, declFamily, byFamily, edgeOf };
}

/** The filename stem is the record's id (SPEC section 3). */
const stemOf = (file) => file.split('/').pop().replace(/\.tres$/, '');

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------
//
// Each entry: { code, severity, scope, run(ctx) -> finding[] }.
// A finding: { code, record, field?, target?, detail }.
// `severity` is the DEFAULT; a finding may override it (dangling-ref does, when
// the edge is `required: false`).

export const RULES = [
  // -- declaration scope: shape of the declaration itself ---------------------
  {
    code: 'duplicate-edge',
    severity: 'violation',
    scope: 'declaration',
    run(ctx) {
      const out = [];
      const seen = new Set();
      for (const e of ctx.decl.edges || []) {
        const id = `${e?.family}.${e?.field}`;
        if (seen.has(id)) out.push({ code: 'duplicate-edge', record: id, detail: `${id} declared twice (edges are idempotent; two rows for one field is an error, never a merge)` });
        seen.add(id);
      }
      return out;
    },
  },
  {
    code: 'unknown-rule',
    severity: 'violation',
    scope: 'declaration',
    run(ctx) {
      const out = [];
      const codes = new Set(ctx.vocabulary || []);
      for (const e of ctx.decl.edges || []) {
        if (!KINDS.includes(e?.kind)) {
          out.push({ code: 'unknown-rule', record: `${e?.family}.${e?.field}`, detail: `edge kind MUST be one of ${KINDS.join('/')}: ${JSON.stringify(e?.kind)}` });
        }
        if (e?.kind !== 'literal' && e?.kind !== 'virtual') {
          const targets = Array.isArray(e?.target) ? e.target : [e?.target];
          for (const t of targets) {
            if (!ctx.knownFamilies.has(t)) out.push({ code: 'unknown-rule', record: `${e?.family}.${e?.field}`, detail: `edge target MUST name a declared family: ${e?.family}.${e?.field} -> ${JSON.stringify(t)}` });
          }
        }
      }
      for (const b of ctx.decl.baselines || []) {
        if (!codes.has(b?.code)) out.push({ code: 'unknown-rule', record: b?.code || '(baseline)', detail: `baseline names a refusal code the vocabulary does not carry: ${JSON.stringify(b?.code)}` });
        if (!b?.reason || !String(b.reason).trim()) out.push({ code: 'unknown-rule', record: b?.code || '(baseline)', detail: `baseline MUST carry a non-empty reason - a silent suppression is politeness theater` });
      }
      return out;
    },
  },

  // -- tree scope: the corpus against the declaration -------------------------
  {
    code: 'undeclared-family',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      for (const fam of ctx.tree.families) {
        if (!ctx.knownFamilies.has(fam.key)) {
          out.push({ code: 'undeclared-family', record: fam.key, detail: `directory holds records but no family declares it` });
        }
      }
      return out;
    },
  },
  {
    code: 'name-dir-mismatch',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      const dirs = new Set(ctx.tree.families.map((f) => f.key));
      for (const f of ctx.decl.families || []) {
        if (!dirs.has(f.key)) {
          out.push({ code: 'name-dir-mismatch', record: f.key, detail: `family key ${JSON.stringify(f.key)} matches no directory in the tree (the key IS its directory name)` });
        }
      }
      return out;
    },
  },
  {
    code: 'schema-mismatch',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      for (const r of ctx.tree.records) {
        const fam = ctx.declFamily.get(r.family);
        if (!fam) continue;
        // `schema` is OPTIONAL and advisory. A family may hold several schemas
        // (the reference tree's `balance/` holds twelve), in which case it declares
        // none and the record's own schema stands. Declaring one asserts that
        // every record in the family carries it.
        if (fam.schema && r.scriptClass && fam.schema !== r.scriptClass) {
          out.push({ code: 'schema-mismatch', record: r.file, detail: `family ${fam.key} declares schema ${fam.schema}, record is ${r.scriptClass}` });
        }
      }
      return out;
    },
  },
  {
    code: 'filename-id-mismatch',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      for (const r of ctx.tree.records) {
        // Only when the record DECLARES an id. An id-less record's stem IS its id
        // (SPEC section 3); there is nothing to disagree with.
        if (!r.idDeclared) continue;
        const fam = ctx.declFamily.get(r.family);
        // The filename IS the id, and a family's idPrefix is PART of the filename:
        // `achievement_bloom_contained.tres` carries id `bloom_contained` under
        // prefix `achievement_`. Requiring stem === id would refuse every prefixed
        // family in the reference tree - a measured false positive.
        const prefix = fam?.idPrefix || '';
        const expected = prefix + r.id;
        if (stemOf(r.file) !== expected) {
          out.push({ code: 'filename-id-mismatch', record: r.file, detail: `declared id "${r.id}" under prefix "${prefix}" expects filename stem "${expected}", found "${stemOf(r.file)}"` });
        }
      }
      return out;
    },
  },
  {
    code: 'undeclared-edge',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      for (const r of ctx.tree.records) {
        for (const [field] of r.fields) {
          if (!/_ids?$/.test(field)) continue;
          const edge = ctx.edgeOf.get(`${r.family}.${field}`);
          if (!edge) {
            out.push({ code: 'undeclared-edge', record: r.file, field, detail: `field ends _id/_ids and no edge declares it (and it is not literal)` });
          }
        }
      }
      return out;
    },
  },
  {
    code: 'dangling-ref',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      for (const r of ctx.tree.records) {
        for (const [field, raw] of r.fields) {
          const edge = ctx.edgeOf.get(`${r.family}.${field}`);
          if (!edge) continue;
          for (const v of idsIn(raw)) {
            if (!resolves(edge.kind, edge.target, v, ctx.tree)) {
              const row = { code: 'dangling-ref', record: r.file, field, target: v, detail: `edge ${r.family}.${field} -> ${edge.target}, "${v}" not found` };
              // `required: false` downgrades to a warning - acknowledged, not asserted.
              if (edge.required === false) row.severity = 'warning';
              out.push(row);
            }
          }
        }
      }
      return out;
    },
  },
  {
    code: 'cycle',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      const cycleEdges = ctx.decl.edges.filter((e) => e.kind === 'ref' && e.required !== false);
      const seen = new Set();
      for (const e of cycleEdges) {
        const pool = ctx.byFamily.get(e.family);
        if (!pool) continue;
        // Follow the edge to ITS target family, not the declaring family. A
        // same-name id in a different family is not a cycle.
        const tkey = Array.isArray(e.target) ? e.target[0] : e.target;
        const tpool = ctx.byFamily.get(tkey);
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
            if (seen.has(pair)) continue;
            seen.add(pair);
            out.push({ code: 'cycle', record: r.file, field: e.field, detail: `${r.id} <-> ${next} via ${e.field}` });
          }
        }
      }
      return out;
    },
  },
];

// Codes the baseline filter owns (they are findings about findings, so they
// cannot be plain rules). The drift gate counts these as produced.
export const BASELINE_CODES = ['baseline-expired', 'baseline-unmatched'];

// ---------------------------------------------------------------------------
// Baselines (mitigations)
// ---------------------------------------------------------------------------
//
// A baseline EXCUSES a matching finding, on the record, with a reason - and the
// excuse is itself checkable: an expired baseline stops excusing (`baseline-expired`,
// a violation) and a baseline that matches nothing is reported so it can be retired
// (`baseline-unmatched`, a warning). Nothing is ever silenced silently.

/** Does a finding match a baseline row? */
function matches(b, f) {
  if (b.code !== f.code) return false;
  if (b.record && b.record !== f.record) return false;
  if (b.field && b.field !== f.field) return false;
  return true;
}

/**
 * Apply baselines to findings. Returns { kept, notes }.
 *   kept  - findings that still refuse (or warn)
 *   notes - baseline-expired / baseline-unmatched findings
 */
export function applyBaselines(findings, baselines, now = new Date()) {
  const list = Array.isArray(baselines) ? baselines : [];
  if (!list.length) return { kept: findings, notes: [] };

  const matched = new Set();
  const expired = [];
  const kept = [];

  for (const f of findings) {
    let excused = false;
    for (const b of list) {
      if (!matches(b, f)) continue;
      if (b.expires && new Date(b.expires) < now) {
        expired.push({ code: 'baseline-expired', record: b.record || f.record, field: f.field, detail: `baseline for ${f.code} expired ${b.expires}: ${b.reason}` });
        continue;
      }
      matched.add(b);
      excused = true;
      break;
    }
    if (!excused) kept.push(f);
  }

  const notes = [...expired];
  for (const b of list) {
    if (!matched.has(b) && !expired.some((e) => e.record === (b.record || e.record) && e.detail.endsWith(b.reason))) {
      notes.push({ code: 'baseline-unmatched', record: b.record || '(any)', field: b.field, detail: `baseline excuses ${b.code} but nothing matched it - retire it: ${b.reason}` });
    }
  }
  return { kept, notes };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Run the registry over a tree + declaration.
 *
 * Returns { schemaVersion, families, records, edges, violations, warnings }.
 * `opts.vocabulary` is the array of known codes (from spec/refusals.json);
 * `opts.extraRules` are host-added rules (each validated against the vocabulary);
 * `opts.now` is the clock baselines read (injectable for tests).
 */
export function runRules(tree, decl, opts = {}) {
  const ctx = buildContext(tree, decl);
  ctx.vocabulary = opts.vocabulary || [...RULES.map((r) => r.code), ...BASELINE_CODES];
  const extra = opts.extraRules || [];

  // A host rule may not invent a code: it must be in the vocabulary it was handed.
  const unknown = [];
  for (const r of extra) {
    if (!ctx.vocabulary.includes(r.code)) {
      unknown.push({ code: 'unknown-rule', record: r.code, detail: `host rule names a code the vocabulary does not carry: ${JSON.stringify(r.code)}` });
    }
  }

  const all = [...unknown];
  for (const rule of [...RULES, ...extra]) {
    const scope = rule.scope || 'tree';
    if (scope === 'declaration') continue; // run below, after shape checks pass
    all.push(...(rule.run(ctx) || []));
  }
  const declFindings = [];
  for (const rule of RULES) {
    if (rule.scope !== 'declaration') continue;
    declFindings.push(...(rule.run(ctx) || []));
  }

  const { kept, notes } = applyBaselines([...declFindings, ...all], decl.baselines, opts.now);

  const violations = [];
  const warnings = [];
  for (const f of [...kept, ...notes]) {
    const severity = f.severity || severityOf(f.code);
    (severity === 'warning' ? warnings : violations).push(f);
  }

  let edgeCount = 0;
  for (const r of tree.records) {
    for (const [field, raw] of r.fields) {
      if (!ctx.edgeOf.has(`${r.family}.${field}`)) continue;
      edgeCount += idsIn(raw).length;
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

const SEVERITY_BY_CODE = new Map(RULES.map((r) => [r.code, r.severity]));
function severityOf(code) {
  if (code === 'baseline-expired') return 'violation';
  if (code === 'baseline-unmatched') return 'warning';
  return SEVERITY_BY_CODE.get(code) || 'violation';
}
