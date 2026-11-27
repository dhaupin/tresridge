/**
 * Types for `tresridge/tres` - the `.tres` reader and the transport seam. Checked
 * against the runtime exports by `test/types.mjs`.
 */

import type { Reader, Tree } from './lint.d.mts';

/** Walk `root` and return every `.tres` file path, recursively. */
export declare function walkTres(root: string): string[];

/** Why a `.tres` file cannot be read as a record, or null if it can. */
export declare function unparseableReason(file: string): string | null;

/** Why a `.tres` TEXT cannot be read as a record, or null if it can. */
export declare function unparseableText(txt: string): string | null;

/** Parse one `.tres` file into a record. */
export declare function parseTres(file: string): {
  id: string;
  idDeclared: boolean;
  scriptClass: string;
  fields: Map<string, string>;
  nested: Map<string, Map<string, string[]>>;
  unparseable?: string;
};

/** Estimated live heap a tree will occupy once read, in bytes. */
export declare function estimateHeap(recordCount: number, sourceBytes: number): number;

/** The built-in `.tres` reader. */
export declare const tresReader: Reader;

/** Why a `--reader` module is not usable as a reader, or null. */
export declare function readerProblem(mod: unknown): string | null;

/** The record suffix a reader names, normalized to `.ext`; '' when it names none. */
export declare function suffixOf(reader: Reader | undefined): string;

/** Why a `parse()` result is not a record, or null if it is. */
export declare function parseProblem(result: unknown, file?: string): string | null;

/** Why a `walk()` result is not a record list, or null if it is. */
export declare function walkProblem(files: unknown, root: string): string | null;

/** Read a record tree. `opts.reader` replaces the built-in `.tres` walk/parse pair. */
export declare function readTree(root: string, opts?: { reader?: Reader }): Tree;

/** Why a root is probably not the contract root (SPEC section 1), or null. */
export declare function rootProblem(
  tree: Tree,
  root: string,
): { code: string; detail: string; hints: string[] } | null;

/** Whether `dir` actually reads as a tree root. */
export declare function looksLikeTreeRoot(dir: string): boolean;
