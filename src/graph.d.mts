/**
 * Types for `tresridge/graph`. Checked against the runtime exports by
 * `test/types.mjs`.
 */

import type { Declaration, DeclaredEdge, Tree } from './lint.d.mts';

/** A field inference could not resolve. A human decides what it is. */
export interface UndeclaredField {
  family: string;
  field: string;
  count: number;
}

/**
 * A field whose values look like ids from another family, but whose name gives the
 * inference nothing to key on. `ratio` is the share of distinct values that name an
 * id elsewhere, so 1.0 is strong evidence and 0.04 is a coincidence.
 */
export interface ProbableEdge {
  family: string;
  field: string;
  count: number;
  distinct: number;
  ratio: number;
  targets: string[];
}

/** What inference left for a human. */
export interface Residue {
  undeclared: UndeclaredField[];
  probable: ProbableEdge[];
}

/** The family an edge field resolves into, or null when it resolves nowhere. */
export declare function targetFor(field: string, familyKeys: Set<string>): string | null;

/** Infer a first-draft declaration, plus what it could not decide. */
export declare function inferDeclaration(tree: Tree): { declaration: Declaration; residue: Residue };

/** Read `root` and infer from it. */
export declare function graph(root: string): { tree: Tree; declaration: Declaration; residue: Residue };

/** Infer from an already-read tree (what the CLI does, so it walks the corpus once). */
export declare function inferFrom(tree: Tree): { declaration: Declaration; residue: Residue };

/** A row that differs between an inferred declaration and the declared one. */
export interface ChangedEdge {
  family: string;
  field: string;
  declared: { target: string | string[]; kind: string };
  inferred: { target: string | string[]; kind: string };
}

/** Compare an inferred declaration to the declared one. */
export declare function diffDeclaration(
  inferred: Declaration,
  declared: Declaration,
  residue?: Residue,
  tree?: Tree | null,
): {
  added: DeclaredEdge[];
  removed: DeclaredEdge[];
  changed: ChangedEdge[];
  /** Declared rows whose field is still in the tree but that inference cannot see. */
  invisible: DeclaredEdge[];
};
