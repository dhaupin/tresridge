/**
 * Types for `tresridge/rules` - the refusal registry. Checked against the runtime
 * exports by `test/types.mjs`.
 */

import type {
  Declaration, EdgeKind, Finding, LintOptions, TreeRecord, Tree,
} from './lint.d.mts';

/** The edge kinds (SPEC section 4). */
export declare const KINDS: EdgeKind[];

/** The declaration schema version. */
export declare const SCHEMA_VERSION: number;

/** The ids a raw field value declares. */
export declare function idsIn(raw: string): string[];

/** Every value of a raw field that is not an id-shaped token. */
export declare function nonIdValues(raw: string): string[];

/** The quoted string values in a raw field value, in order. */
export declare function quotedValues(raw: string): string[];

/** Whether `value` resolves against `tree` under an edge `kind`. `target` may be a union. */
export declare function resolves(
  kind: EdgeKind,
  target: string | string[],
  value: string,
  tree: Tree,
): boolean;

/** Whether `value` matches a virtual edge's `<stem>` pattern. */
export declare function resolvesVirtual(
  pattern: string,
  families: Record<string, string>,
  value: string,
  tree: Tree,
): boolean;

/** Canonicalize an edge field name: `entries[].item_id` and `entries.item_id` are one. */
export declare function canonField(field: string): string;

/** The raw value strings one edge reads from one record. */
export declare function edgeValues(record: TreeRecord, edge: { field: string }): string[];

/** The declaration key for an edge: `family.field`, canonicalized. */
export declare const edgeKey: (edge: { family: string; field: string }) => string;

/** The read-only context every rule receives. */
export interface RuleContext {
  tree: Tree;
  decl: Declaration;
  declared: Set<string>;
  knownFamilies: Set<string>;
  declFamily: Map<string, unknown>;
  byFamily: Map<string, Map<string, TreeRecord>>;
  byId: Map<string, Map<string, TreeRecord>>;
  edgeOf: Map<string, unknown>;
  vocabulary?: string[];
}

/** Build the context every rule receives. */
export declare function buildContext(tree: Tree, decl: Declaration): RuleContext;

/** A registry rule. */
export interface RegistryRule {
  code: string;
  severity: 'violation' | 'warning';
  scope?: 'tree' | 'declaration';
  run(ctx: RuleContext): Finding[] | void;
}

/** The refusal registry: the single source the vocabulary and the spec table read. */
export declare const RULES: RegistryRule[];

/** Baseline-only codes: notes the baseline machinery itself can emit. */
export declare const BASELINE_CODES: string[];

/** The keys a baseline entry may carry. */
export declare const BASELINE_KEYS: string[];

/** Apply baselines to findings. `kept` still refuses; `notes` are expired/unmatched. */
export declare function applyBaselines(
  findings: Finding[],
  baselines: unknown,
  now?: Date,
): { kept: Finding[]; notes: Finding[] };

/** Run the registry (plus host rules) over a tree. */
export declare function runRules(
  tree: Tree,
  decl: Declaration,
  opts?: LintOptions,
): import('./lint.d.mts').LintResult;
