#!/usr/bin/env node
/**
 * scripts/check-vocabulary.mjs - the drift gate.
 *
 * The spec, the registry, and the battery are ONE source. This gate refuses when
 * they disagree, in either direction:
 *
 *   - a code in the registry but not in spec/refusals.json  (undocumented refusal)
 *   - a code in the vocabulary but not in the registry      (a promise with no check)
 *   - a code the battery never exercises                    (an unproven refusal)
 *   - the SPEC section 7 table disagrees with the vocabulary
 *
 * This is what makes "define it, enforce it" mechanical: you cannot add a refusal
 * to the code without documenting it, cannot document one without implementing it,
 * and cannot ship one without a battery row that proves it fires.
 *
 * --write: regenerate the section 7 table inside spec/SPEC.md from the vocabulary.
 * Default: check only (exit 1 on drift).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, BASELINE_CODES } from '../src/rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

const vocab = JSON.parse(readFileSync(join(ROOT, 'spec', 'refusals.json'), 'utf8'));
const vocabCodes = vocab.codes.map((c) => c.code);
const registryCodes = [...RULES.map((r) => r.code), ...BASELINE_CODES];

// The battery: which codes does it actually exercise?
const batteryDir = join(ROOT, 'labs', 'refusal-battery');
const battery = readFileSync(join(ROOT, 'labs', 'refusal-matrix.tresridge.json'), 'utf8');
const matrix = JSON.parse(battery);
const exercised = new Set();
for (const row of matrix.rows) {
  for (const c of row.observed.violations || []) exercised.add(c);
  for (const c of row.observed.warnings || []) exercised.add(c);
  for (const c of row.observed.declErrors || []) exercised.add(c);
}

const problems = [];
const undocumented = registryCodes.filter((c) => !vocabCodes.includes(c));
const unimplemented = vocabCodes.filter((c) => !registryCodes.includes(c));
const unproven = vocabCodes.filter((c) => !exercised.has(c));

if (undocumented.length) problems.push(`in the registry but NOT in spec/refusals.json: ${undocumented.join(', ')}`);
if (unimplemented.length) problems.push(`in spec/refusals.json but NOT in the registry: ${unimplemented.join(', ')}`);
if (unproven.length) problems.push(`in the vocabulary but NEVER exercised by the battery: ${unproven.join(', ')}`);

// The SPEC section 7 table must be the vocabulary, verbatim.
const specPath = join(ROOT, 'spec', 'SPEC.md');
const spec = readFileSync(specPath, 'utf8');
const table = renderTable(vocab.codes);
const hasTable = spec.includes(table);

if (!hasTable && !WRITE) problems.push(`the SPEC section 7 table disagrees with spec/refusals.json (run \`node scripts/check-vocabulary.mjs --write\`)`);

if (WRITE) {
  const next = replaceTable(spec, table);
  if (next !== spec) {
    writeFileSync(specPath, next);
    console.log('  SPEC section 7 table regenerated from spec/refusals.json');
  } else {
    console.log('  SPEC section 7 table already current');
  }
}

if (problems.length) {
  console.error('\n  VOCABULARY DRIFT:');
  for (const p of problems) console.error(`    - ${p}`);
  console.error('\n  The spec, the registry, and the battery are one source. Fix the drift, do not silence it.');
  process.exit(1);
}
console.log(`  vocabulary consistent: ${vocabCodes.length} codes, all documented, implemented, and exercised.`);

// ---------------------------------------------------------------------------

/** Render the section 7 table from the vocabulary. */
function renderTable(codes) {
  const rows = codes.map((c) => `| \`${c.code}\` | ${c.severity} | ${c.section} | ${c.detail} |`);
  return ['| Refusal | Severity | Spec | Fires when |', '|---|---|---|---|', ...rows].join('\n');
}

/** Swap the generated table into the spec, between the markers. */
function replaceTable(spec, table) {
  const start = '<!-- BEGIN GENERATED: section 7 refusals -->';
  const end = '<!-- END GENERATED: section 7 refusals -->';
  const block = `${start}\n${table}\n${end}`;
  if (spec.includes(start) && spec.includes(end)) {
    return spec.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return spec;
}
