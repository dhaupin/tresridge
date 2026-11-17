// The refusal vocabulary, read from spec/refusals.json - the one source.
//
// The vocabulary is DATA (a JSON file a non-JS host can read), not code. This
// module is the JS reader for it. The spec's section 7 table is generated from
// the same file, and `scripts/check-vocabulary.mjs` refuses when it, the rule
// registry, and the battery disagree.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const doc = JSON.parse(readFileSync(join(ROOT, 'spec', 'refusals.json'), 'utf8'));

/** Every refusal code this lint carries, in vocabulary order. */
export const VOCABULARY = doc.codes.map((c) => c.code);

/** The full vocabulary document (codes, severities, spec sections). */
export const VOCABULARY_DOC = doc;

/** Severity for a code, from the vocabulary. */
export function severityOfCode(code) {
  return doc.codes.find((c) => c.code === code)?.severity || 'violation';
}
