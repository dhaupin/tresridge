#!/usr/bin/env node
/**
 * scripts/check-docs.mjs - the published-numbers gate.
 *
 * The refusal matrix keeps the REFUSALS honest. Nothing kept the NUMBERS honest, and
 * so they drifted: the README advertised "61 declaration edges (49 inferred / 12
 * needing declaration)" and the spec "344 edges / 14 residue" while the reference tree
 * actually measured 57 inferred / 16 residue. Families and records were exact, which
 * is exactly how a stale number survives a review - most of the sentence is right.
 *
 * Two things are gated here:
 *
 *   1. THE FIXTURE. `conformance/fixture/` is a committed corpus, so the numbers this
 *      repo publishes can be reproduced by anyone, forever, with one command. Every
 *      figure in the generated block is MEASURED from it on each run.
 *
 *   2. THE PROSE. The block between the BEGIN/END markers in README.md is generated
 *      from that measurement. `--write` regenerates it; the default refuses drift.
 *
 *   3. THE LINKS. README.md is the npm package page, but npm ships only `files` from
 *      package.json - so a relative link to anything outside that set renders as a 404
 *      to every visitor of the registry page, while working perfectly in the checkout.
 *      Three did (`labs/`, `labs/prd-tresridge.md`, `conformance/fixture/`). This cannot
 *      be caught by reading the README, only by comparing it against `files`.
 *
 * The reference deployment (a host's own tree) is deliberately NOT gated: this repo
 * cannot see it, and pinning a number it cannot check is how the drift started. Those
 * figures live in `labs/` as a dated snapshot instead.
 *
 * --write: regenerate the generated blocks. Default: check only (exit 1 on drift).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTree } from '../src/tres.mjs';
import { graph } from '../src/graph.mjs';
import { lint, validateDeclaration } from '../src/lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FIXTURE = join(ROOT, 'conformance', 'fixture');

/** Measure the committed fixture. Every published figure comes from here. */
function measure() {
  const { tree, declaration, residue } = graph(FIXTURE);
  const declPath = join(FIXTURE, 'relations.json');
  const decl = JSON.parse(readFileSync(declPath, 'utf8'));
  const declErrors = validateDeclaration(decl);
  const result = lint(tree, decl);
  return {
    families: tree.families.length,
    records: tree.records.length,
    edgesInferred: declaration.edges.length,
    residueFields: residue.undeclared.length,
    residueOccurrences: residue.undeclared.reduce((n, u) => n + u.count, 0),
    edgesDeclared: decl.edges.length,
    edgesResolved: result.edges,
    violations: result.violations.length,
    warnings: result.warnings.length,
    declErrors: declErrors.length,
  };
}

const m = measure();

/** The generated block, as published. */
const block = [
  '<!-- BEGIN GENERATED: fixture measurement -->',
  '',
  '| the committed fixture | |',
  '|---|---|',
  `| families | ${m.families} |`,
  `| records | ${m.records} |`,
  `| edges inferred | ${m.edgesInferred} |`,
  `| residue fields | ${m.residueFields} |`,
  `| edges declared | ${m.edgesDeclared} |`,
  `| edges resolved | ${m.edgesResolved} |`,
  `| violations | ${m.violations} |`,
  `| warnings | ${m.warnings} |`,
  '',
  '<!-- END GENERATED: fixture measurement -->',
].join('\n');

// The fixture declaration must itself be clean: a published number measured over a
// dirty tree would be honest about the wrong thing.
const problems = [];
if (m.declErrors) problems.push(`the fixture declaration does not validate (${m.declErrors} shape error(s))`);
if (m.violations) problems.push(`the fixture tree does not lint clean (${m.violations} violation(s))`);
if (m.warnings) problems.push(`the fixture tree does not lint clean (${m.warnings} warning(s))`);

/** Swap the generated block into a file, between the markers. */
function replaceBlock(text, next) {
  const start = '<!-- BEGIN GENERATED: fixture measurement -->';
  const end = '<!-- END GENERATED: fixture measurement -->';
  if (!text.includes(start) || !text.includes(end)) return null;
  return text.replace(new RegExp(`${start}[\\s\\S]*?${end}`), next);
}

const targets = ['README.md'];
for (const rel of targets) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) { problems.push(`${rel} is missing`); continue; }
  const text = readFileSync(path, 'utf8');
  const next = replaceBlock(text, block);
  if (next === null) {
    problems.push(`${rel} has no BEGIN/END GENERATED: fixture measurement block`);
    continue;
  }
  if (next === text) continue;
  if (WRITE) { writeFileSync(path, next); console.log(`  ${rel}: generated block rewritten`); }
  else problems.push(`${rel} publishes numbers that disagree with the fixture (run \`node scripts/check-docs.mjs --write\`)`);
}

// README.md is the registry page. npm publishes only `files`, so a relative link to
// anything else is a 404 for every visitor while working in the checkout. Compared
// against `files` rather than a hand list, because a hand list is what drifts.
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const shipped = new Set(pkg.files || []);
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const [, target] of readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const top = target.split('#')[0].replace(/^\.\//, '').split('/')[0];
    if (top && !shipped.has(top)) {
      problems.push(`README.md links \`${target}\`, which \`files\` does not ship - a 404 on npmjs.com (use an absolute GitHub URL)`);
    }
  }
}


if (problems.length) {
  console.error('\n  DOCS DRIFT:');
  for (const p of problems) console.error(`    - ${p}`);
  console.error('\n  Published numbers are measured, never remembered; published links must ship.');
  process.exit(1);
}

console.log(`  docs consistent: fixture measures ${m.families} families, ${m.records} records, ${m.edgesInferred} edges inferred, ${m.residueFields} residue; published block matches.`);
