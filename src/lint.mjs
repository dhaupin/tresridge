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

  const seenFamily = new Set();
  for (const f of decl?.families || []) {
    // A family key IS its directory name. Godot content trees use snake_case
    // (`loot_tables`), so the rule is "identifier-shaped", not "kebab-case" -
    // the kebab rule was an invention the reference tree immediately refused.
    if (!/^[a-z0-9]+([_-][a-z0-9]+)*$/.test(f?.key || '')) {
      out.push(`family key MUST be an identifier (its directory name): ${JSON.stringify(f?.key)}`);
    }
    if (seenFamily.has(f?.key)) out.push(`duplicate family key: ${f?.key}`);
    seenFamily.add(f?.key);
  }

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
