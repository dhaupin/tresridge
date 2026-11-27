/**
 * Type declarations for tresridge.
 *
 * These describe the surface `package.json#exports` publishes, and nothing under
 * `src/` that the map does not expose. They are checked against the real runtime
 * exports by `test/types.mjs`, so a symbol added to or removed from a module fails
 * the battery rather than quietly making this file wrong.
 */

/** The edge kinds a declaration may carry (SPEC section 4). */
export type EdgeKind = 'ref' | 'refs' | 'nested' | 'virtual' | 'literal';

/** A family in a declaration: one directory of records. */
export interface DeclaredFamily {
  key: string;
  schema?: string;
  idPrefix?: string;
}

/** An edge in a declaration: how one family's field refers into another. */
export interface DeclaredEdge {
  family: string;
  /** `field`, or a nested `field.inner` (SPEC section 4). */
  field: string;
  target: string;
  kind: EdgeKind;
  required?: boolean;
}

/** A baseline entry: a known finding, tolerated until it expires. */
export interface Baseline {
  code: string;
  record: string;
  field?: string;
  reason: string;
  expires?: string;
}

/** A declaration: the authoritative statement of what the tree's edges mean. */
export interface Declaration {
  schemaVersion: number;
  families: DeclaredFamily[];
  edges: DeclaredEdge[];
  /** Maps a virtual `<stem>` to the family its captures resolve in. */
  virtualFamilies?: Record<string, string>;
  baselines?: Baseline[];
}

/**
 * One refusal. `code` is the vocabulary entry (see `CODES`); `record` is the file
 * the finding is attributed to, or a declaration/symbol name for a shape refusal.
 */
export interface Finding {
  code: string;
  record: string;
  field?: string;
  detail?: string;
  severity?: 'violation' | 'warning';
  /** Set when a pack's rule produced the finding (SPEC section 5). */
  pack?: string;
}

/** What a lint run returns. */
export interface LintResult {
  schemaVersion: number;
  families: number;
  records: number;
  edges: number;
  violations: Finding[];
  warnings: Finding[];
}

/** A rule, as a host extension or a pack supplies one. */
export interface Rule {
  code: string;
  severity: 'violation' | 'warning';
  scope?: 'tree' | 'declaration';
  pack?: string;
  run(ctx: unknown): Finding[] | void;
}

export interface LintOptions {
  /** Codes a rule may carry. A rule naming a code outside this is refused. */
  vocabulary?: string[];
  /** Host-added rules, run alongside the registry. */
  extraRules?: Rule[];
  /** Reference time for baseline expiry. Defaults to now. */
  now?: Date;
}

/** A record as the reader produced it: `fields` and `nested` are Maps. */
export interface TreeRecord {
  file: string;
  family: string;
  id: string;
  idDeclared: boolean;
  key: string;
  scriptClass: string;
  fields: Map<string, string>;
  nested: Map<string, Map<string, string[]>>;
  unparseable?: string;
}

export interface Family {
  key: string;
  schema: string;
  count: number;
  schemas: string[];
  dirs: string[];
}

/** A read tree, as `readTree()` returns it. */
export interface Tree {
  root: string;
  families: Family[];
  records: TreeRecord[];
  idsByFamily: Map<string, Set<string>>;
  /** The reader's name (`.tres` by default). */
  reader: string;
}

/**
 * A transport. `walk` returns absolute record paths; `parse` turns one into a
 * record. Supplying one is how a host lints its own format instead of converting
 * its tree to `.tres` first.
 */
export interface Reader {
  name: string;
  ext?: string;
  walk(root: string): string[];
  parse(file: string): {
    id: string;
    idDeclared: boolean;
    scriptClass: string;
    fields: Map<string, string>;
    nested: Map<string, Map<string, string[]>>;
    unparseable?: string;
  };
}

export interface ReadTreeOptions {
  reader?: Reader;
}

/** The refusal codes this lint can emit. */
export declare const CODES: string[];

/** The edge kinds, as a runtime array. */
export declare const KINDS: EdgeKind[];

/** The declaration schema version. */
export declare const SCHEMA_VERSION: number;

/** The ids a raw field value declares. */
export declare function idsIn(raw: string): string[];

/** Every value of a raw field that is not an id-shaped token. */
export declare function nonIdValues(raw: string): string[];

/** Whether `value` resolves against `tree` under an edge `kind`. */
export declare function resolves(kind: EdgeKind, target: string, value: string, tree: Tree): boolean;

/** Check a declaration's own shape. Returns refusal strings; empty means valid. */
export declare function validateDeclaration(decl: Declaration, opts?: LintOptions): string[];

/** Lint a read tree against a declaration. */
export declare function lint(tree: Tree, decl: Declaration, opts?: LintOptions): LintResult;

/** Read a tree and lint it in one call. */
export declare function lintRoot(root: string, decl: Declaration, opts?: LintOptions): LintResult;

