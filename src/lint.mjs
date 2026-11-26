// The conformance lint: check a record tree against a declaration.
//
// This module is a FACADE. It holds no refusals of its own - every one lives in
// `src/rules.mjs`, the registry, which is the single source the vocabulary
// (`spec/refusals.json`), the spec's section 7 table, and the battery all read.
// The discipline is unchanged (SPEC section 6): the declaration is authoritative
// and the lint NEVER infers at check time.

import { readTree } from './tres.mjs';
import {
  RULES,
  BASELINE_CODES,
  KINDS,
  SCHEMA_VERSION,
  runRules,
  buildContext,
  idsIn,
  nonIdValues,
  resolves,
} from './rules.mjs';

export { KINDS, SCHEMA_VERSION, idsIn, nonIdValues, resolves };

/** The refusal codes this lint can emit: the registry plus the baseline notes. */
export const CODES = [...RULES.map((r) => r.code), ...BASELINE_CODES];

/**
 * Validate a declaration's own shape. Returns an array of refusal strings.
 *
 * The shape rules are the `declaration`-scope entries of the registry, so the
 * declaration is checked by the same machinery as the tree (SPEC section 8).
 */
export function validateDeclaration(decl, opts = {}) {
  const out = [];
  if (decl?.schemaVersion !== SCHEMA_VERSION) {
    out.push(`declaration schemaVersion MUST be ${SCHEMA_VERSION} (have: ${JSON.stringify(decl?.schemaVersion)})`);
  }
  if (!Array.isArray(decl?.families)) out.push('declaration families MUST be an array');
  if (!Array.isArray(decl?.edges)) out.push('declaration edges MUST be an array');
  // Nothing below can run meaningfully over a non-array: `buildContext` maps both,
  // so continuing turns a named shape refusal into a raw TypeError at the call site.
  if (out.length) return out;

  // `virtualFamilies` maps a `<stem>` to the family its captures resolve in. A typo in
  // its SHAPE (a string, an array) makes `(families || {})[name]` return undefined, and
  // `stemsResolve` treats a missing mapping as "nothing to check" - so every virtual
  // edge silently stops checking its captures. Refusing the shape here is the difference
  // between a typo caught at load and a whole rule class switched off.
  if (decl?.virtualFamilies !== undefined) {
    const vf = decl.virtualFamilies;
    if (!vf || typeof vf !== 'object' || Array.isArray(vf)) {
      out.push(`declaration virtualFamilies MUST be an object mapping <stem> to a family key (have: ${JSON.stringify(vf)})`);
    } else {
      for (const [stem, fam] of Object.entries(vf)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stem)) {
          out.push(`virtualFamilies stem MUST be identifier-shaped: ${JSON.stringify(stem)}`);
        }
        if (typeof fam !== 'string' || !fam) {
          out.push(`virtualFamilies.${stem} MUST name a family key: ${JSON.stringify(fam)}`);
        } else if (!Array.isArray(decl.families) || !decl.families.some((f) => f?.key === fam)) {
          out.push(`virtualFamilies.${stem} names ${JSON.stringify(fam)}, which is not a declared family`);
        }
      }
    }
  }

  // `baselines` is a list. A string is iterable, so it passed every array-shaped check
  // downstream and produced one bogus finding PER CHARACTER - a 2,000-character typo
  // is 6,000 findings that bury the real one.
  if (decl?.baselines !== undefined && !Array.isArray(decl.baselines)) {
    out.push(`declaration baselines MUST be an array (have: ${JSON.stringify(decl.baselines)})`);
  }

  // An edge row with a null/absent family or field cannot be matched to any record, so
  // it is a declaration that declares nothing - the silent skip this spec forbids. The
  // null case also crashed the registry outright (`Cannot read properties of null`).
  if (Array.isArray(decl?.edges)) {
    decl.edges.forEach((e, i) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        out.push(`edge[${i}] MUST be an object (have: ${JSON.stringify(e)})`);
        return;
      }
      if (typeof e.family !== 'string' || !e.family) out.push(`edge[${i}].family MUST be a family key (have: ${JSON.stringify(e.family)})`);
      if (typeof e.field !== 'string' || !e.field) out.push(`edge[${i}].field MUST be a field path (have: ${JSON.stringify(e.field)})`);
    });
  }

  const seenFamily = new Set();
  for (const f of decl?.families || []) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      out.push(`family entry MUST be an object carrying a key (have: ${JSON.stringify(f)})`);
      continue;
    }
    // A family key IS its directory name. Godot content trees use snake_case
    // (`loot_tables`), so the rule is "identifier-shaped", not "kebab-case" -
    // the kebab rule was an invention the reference tree immediately refused.
    if (!/^[a-z0-9]+([_-][a-z0-9]+)*$/.test(f?.key || '')) {
      out.push(`family key MUST be an identifier (its directory name): ${JSON.stringify(f?.key)}`);
    }
    if (seenFamily.has(f?.key)) out.push(`duplicate family key: ${f?.key}`);
    seenFamily.add(f?.key);
  }

  // A malformed family or edge row has already been named above. Running the registry
  // over it would throw (`buildContext` dereferences `.key` and `edgeKey` reads
  // `.family`), turning a named shape refusal into an exit-2 stack trace - so the
  // shape findings are the whole answer and nothing below is safe to run.
  if (out.length) return out;

  // The declaration-scope registry entries, run over an empty tree.
  const ctx = buildContext({ families: [], records: [], idsByFamily: new Map() }, decl || { families: [], edges: [] });
  ctx.vocabulary = opts.vocabulary || CODES;
  for (const rule of RULES) {
    if (rule.scope !== 'declaration') continue;
    for (const f of rule.run(ctx) || []) out.push(`${f.code}: ${f.detail}`);
  }
  return out;
}

/**
 * Lint a record tree against a declaration.
 *
 * Returns { families, records, edges, violations, warnings }.
 * Violations carry { code, record, field, target, detail }.
 *
 * `opts.extraRules` are host-added rules (the extension surface); a host rule
 * whose code is not in `opts.vocabulary` is itself refused.
 */
export function lint(tree, decl, opts = {}) {
  return runRules(tree, decl, opts);
}

/** Read + lint in one call (convenience for embedders). */
export function lintRoot(root, decl, opts = {}) {
  return lint(readTree(root), decl, opts);
}
