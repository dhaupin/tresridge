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

import { rootProblem } from './tres.mjs';

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
 * `literal` never resolves; `virtual` resolves by PATTERN (below).
 *
 * `target` may be a single family key or an ARRAY of keys - a union family.
 * Item ids, for example, live across weapons/armors/resources/... so the edge
 * names the union rather than one directory (SPEC section 4).
 */
export function resolves(kind, target, value, tree) {
  if (kind === 'literal') return true;
  const targets = Array.isArray(target) ? target : [target];
  for (const t of targets) {
    const pool = tree.idsByFamily.get(t);
    if (pool && pool.has(value)) return true;
  }
  return false;
}

/**
 * Resolve a `virtual` edge (SPEC section 5): the id is a PATTERN the host expands
 * at runtime (`book_<skill_id>_<tier>`), so no record carries it. The lint does not
 * run the expansion; it checks what it can see:
 *
 *   1. the value matches the declared pattern (else the pattern is unenforced),
 *   2. every `<name>` capture resolves as an id in its own family.
 *
 * `pattern` is required for a virtual edge - a virtual edge with no pattern is
 * refused by the `unknown-rule` shape check, because otherwise `virtual` is a
 * silent skip, which is the exact thing the spec forbids.
 */
export function resolvesVirtual(pattern, families, value, tree) {
  if (!pattern) return false;
  // Split the pattern into literals and `<stem>` captures.
  const tokens = [];
  let rest = String(pattern);
  while (rest.length) {
    const i = rest.indexOf('<');
    if (i < 0) { tokens.push({ lit: rest }); break; }
    if (i > 0) tokens.push({ lit: rest.slice(0, i) });
    const j = rest.indexOf('>', i);
    if (j < 0) { tokens.push({ lit: rest.slice(i) }); break; }
    tokens.push({ stem: rest.slice(i + 1, j) });
    rest = rest.slice(j + 1);
  }
  const stemsResolve = (name, s) => {
    const fam = (families || {})[name];
    if (!fam) return true; // no family mapping declared: nothing to check
    const pool = tree.idsByFamily.get(fam);
    return !!pool && pool.has(s);
  };
  // Backtracking match: a stem's length is not known a priori (`akkan_rune_chain`
  // is a stem, not `akkan`), so try every split and accept the first that resolves.
  const walk = (ti, vi) => {
    if (ti === tokens.length) return vi === value.length;
    const t = tokens[ti];
    if (t.lit !== undefined) {
      return value.startsWith(t.lit, vi) && walk(ti + 1, vi + t.lit.length);
    }
    for (let end = vi + 1; end <= value.length; end++) {
      if (stemsResolve(t.stem, value.slice(vi, end)) && walk(ti + 1, end)) return true;
    }
    return false;
  };
  return walk(0, 0);
}

/**
 * Canonicalize a nested field path.
 *
 * The spec writes the array step as `entries[].item_id`; the tree stores the
 * path as `entries.item_id`. Both name one edge, so both must resolve to one
 * key - otherwise a declaration written from the spec is silently skipped,
 * which is the failure mode this standard exists to end.
 */
export function canonField(field) {
  return String(field).replace(/\[\]/g, '');
}

/**
 * The raw value strings an edge reads from one record.
 *
 * A top-level edge (`entries`) reads the record's own field. A nested edge
 * (`entries.item_id`, or `entries[].item_id` per the spec) reads level-1 keys
 * of the dict / array-of-dicts value - `entries = [{ "item_id": "a" }, ...]`
 * yields both. The nested form is what makes `nested` enforceable at all; the
 * earlier parser flattened the dicts, so this could only ever see one value.
 */
export function edgeValues(record, edge) {
  const parts = canonField(edge.field).split('.');
  if (parts.length === 2) {
    const inner = record.nested?.get(parts[0]);
    return inner ? inner.get(parts[1]) || [] : [];
  }
  const raw = record.fields.get(parts[0]);
  return raw === undefined ? [] : [raw];
}

/**
 * The declaration key for an edge: `family.field`, canonicalized so the spec's
 * `entries[].item_id` and the tree's `entries.item_id` are ONE key - a `[]`-form
 * declaration must not be silently skipped.
 */
export const edgeKey = (edge) => `${edge.family}.${canonField(edge.field)}`;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Build the read-only context every rule receives. */
export function buildContext(tree, decl) {
  const declared = new Set();
  for (const e of decl.edges) declared.add(edgeKey(e));
  const knownFamilies = new Set(decl.families.map((f) => f.key));
  const declFamily = new Map(decl.families.map((f) => [f.key, f]));
  const byFamily = new Map();
  for (const r of tree.records) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, new Map());
    byFamily.get(r.family).set(r.id, r);
  }
  const edgeOf = new Map();
  for (const e of decl.edges) edgeOf.set(edgeKey(e), e);
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
        const id = edgeKey(e || { family: '?', field: '?' });
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
          if (e?.kind === 'virtual') {
            // A virtual edge with no pattern is a silent skip - exactly what
            // the spec forbids. The pattern is what makes it checkable at all.
            if (!e?.pattern || !String(e.pattern).includes('<')) {
              out.push({ code: 'unknown-rule', record: `${e?.family}.${e?.field}`, detail: `virtual edge MUST declare a pattern with at least one <stem>: ${JSON.stringify(e?.pattern)}` });
            }
          } else if (e?.kind !== 'literal') {
          const targets = Array.isArray(e?.target) ? e.target : [e?.target];
          for (const t of targets) {
            if (!ctx.knownFamilies.has(t)) out.push({ code: 'unknown-rule', record: `${e?.family}.${e?.field}`, detail: `edge target MUST name a declared family: ${e?.family}.${e?.field} -> ${JSON.stringify(t)}` });
          }
        }
      }
      for (const b of ctx.decl.baselines || []) {
        if (!codes.has(b?.code)) out.push({ code: 'unknown-rule', record: b?.code || '(baseline)', detail: `baseline names a refusal code the vocabulary does not carry: ${JSON.stringify(b?.code)}` });
        if (!b?.reason || !String(b.reason).trim()) out.push({ code: 'unknown-rule', record: b?.code || '(baseline)', detail: `baseline MUST carry a non-empty reason - a silent suppression is politeness theater` });
        // An unknown key is IGNORED by the matcher, which turns a narrow row into
        // a catch-all - a silent suppression. Refuse it instead.
        for (const k of Object.keys(b || {})) {
          if (!BASELINE_KEYS.includes(k)) out.push({ code: 'unknown-rule', record: b?.code || '(baseline)', detail: `baseline carries an unknown key ${JSON.stringify(k)} (allowed: ${BASELINE_KEYS.join(', ')}) - an ignored key is a silent suppression` });
        }
      }
      return out;
    },
  },

  // -- tree scope: the corpus against the declaration -------------------------
  {
    code: 'empty-tree',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      // A clean verdict over zero records is vacuous, and vacuous is the shape a
      // silent pass takes. Refuse it so a wrong root cannot read as a pass.
      if (ctx.tree.records.length) return [];
      return [{ code: 'empty-tree', record: ctx.tree.root || '(tree)', detail: `no .tres records under the root - a clean verdict here would be vacuous` }];
    },
  },
  {
    code: 'not-a-tree-root',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      // SPEC section 1: the root is the directory whose children are family
      // directories. A root above it collapses the corpus into one family (0 edges);
      // a root below it turns every record into a family. Both read as plausible
      // trees, so they are refused rather than guessed at.
      const problem = rootProblem(ctx.tree, ctx.tree.root || '(tree)');
      if (!problem || problem.code !== 'not-a-tree-root') return [];
      return [{ code: 'not-a-tree-root', record: ctx.tree.root || '(tree)', detail: problem.detail }];
    },
  },
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
      const seen = new Set();
      for (const r of ctx.tree.records) {
        // Top-level fields (`currency_id`) AND level-1 nested keys
        // (`entries.item_id`). A nested `_id` that no edge declares is the same
        // defect as a top-level one - the spec says every `_id` field is
        // declared or literal, and a dict is not an exemption.
        const candidates = [...r.fields.keys()].map((f) => ({ field: f, path: `${r.family}.${f}` }));
        for (const [outer, inner] of r.nested || []) {
          for (const key of inner.keys()) {
            candidates.push({ field: `${outer}.${key}`, path: `${r.family}.${outer}.${key}` });
          }
        }
        for (const { field, path } of candidates) {
          const leaf = field.split('.').pop();
          if (!/_ids?$/.test(leaf)) continue;
          if (ctx.edgeOf.has(path)) continue;
          // A top-level declaration of the same leaf covers a nested occurrence
          // only when the edge names the nested path; otherwise it is undeclared.
          const id = `${r.family}.${field}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ code: 'undeclared-edge', record: r.file, field, detail: `field ends _id/_ids and no edge declares it (and it is not literal)` });
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
        for (const edge of ctx.decl.edges) {
          if (edge.family !== r.family) continue;

        // A virtual edge with no pattern is a DECLARATION defect: `unknown-rule`

        // names it once. Resolving it here would emit a dangler per value, burying

        // the real problem under noise.

        if (edge.kind === 'virtual' && !edge.pattern) continue;
          for (const raw of edgeValues(r, edge)) {
          for (const v of idsIn(raw)) {
              const ok = edge.kind === 'virtual'
                ? resolvesVirtual(edge.pattern, ctx.decl.virtualFamilies, v, ctx.tree)
                : resolves(edge.kind, edge.target, v, ctx.tree);
              if (!ok) {
                const row = { code: 'dangling-ref', record: r.file, field: edge.field, target: v, detail: edge.kind === 'virtual'
                  ? `virtual edge ${r.family}.${edge.field} pattern "${edge.pattern}", "${v}" does not match or its stems do not resolve`
                  : `edge ${r.family}.${edge.field} -> ${edge.target}, "${v}" not found` };
              // `required: false` downgrades to a warning - acknowledged, not asserted.
              if (edge.required === false) row.severity = 'warning';
              out.push(row);
            }
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
/**
 * Does a baseline row excuse a finding?
 *
 * `record` and `field` are optional matchers; absent, the row matches any. Each
 * may carry `*`/`?` globs, so one row can excuse a class (`loot_tables/*.tres`)
 * without listing every record - but a row that matches nothing is reported
 * (`baseline-unmatched`), so a too-broad or stale glob is visible, never silent.
 */
function matches(b, f) {
  if (b.code !== f.code) return false;
  if (b.record && !globMatch(b.record, f.record)) return false;
  if (b.field && !globMatch(b.field, f.field)) return false;
  return true;
}

/** Glob match: `*` = any run, `?` = one char, everything else literal. */
function globMatch(pattern, value) {
  if (value === undefined || value === null) return false;
  const rx = new RegExp('^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return rx.test(String(value));
}

/** The keys a baseline row may carry. An unknown key is refused, not ignored. */
export const BASELINE_KEYS = ['code', 'record', 'field', 'reason', 'expires'];

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
      const f = { code: 'unknown-rule', record: r.code, detail: `host rule names a code the vocabulary does not carry: ${JSON.stringify(r.code)}` };
      if (r.pack) f.pack = r.pack;
      unknown.push(f);
    }
  }

  const all = [...unknown];
  // A finding is attributed to the pack whose rule produced it (SPEC section 5:
  // a conforming loader names the offending pack), so a consumer reading
  // violations[] can tell a core refusal from a pack's without a second lookup.
  const collect = (rule) => {
    const found = rule.run(ctx) || [];
    return rule.pack ? found.map((f) => (f.pack ? f : { ...f, pack: rule.pack })) : found;
  };
  for (const rule of [...RULES, ...extra]) {
    const scope = rule.scope || 'tree';
    if (scope === 'declaration') continue; // run below, after shape checks pass
    all.push(...collect(rule));
  }
  const declFindings = [];
  for (const rule of RULES) {
    if (rule.scope !== 'declaration') continue;
    declFindings.push(...collect(rule));
  }
  // Host rules run at declaration scope too. Skipping them here was a silent skip:
  // `--rules` promises that host rules ADD findings, and a rule whose whole check is
  // about the declaration would never have run.
  for (const rule of extra) {
    if ((rule.scope || 'tree') !== 'declaration') continue;
    declFindings.push(...collect(rule));
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
    for (const edge of decl.edges) {
      if (edge.family !== r.family) continue;
      for (const raw of edgeValues(r, edge)) edgeCount += idsIn(raw).length;
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
