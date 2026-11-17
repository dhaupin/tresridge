#!/usr/bin/env node
// tresridge CLI. Exit contract: 0 clean, 1 violations, 2 usage (SPEC section 8).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTree } from '../src/tres.mjs';
import { lint, validateDeclaration, SCHEMA_VERSION } from '../src/lint.mjs';
import { graph } from '../src/graph.mjs';

const USAGE = `tresridge - the .tres relation standard

  tresridge lint <tree> [--decl <file>] [--json]
  tresridge graph <tree> [--out <file>] [--json]
  tresridge doctor <tree> [--decl <file>]

  lint     every declared edge resolves; no undeclared _id; no cycles
  graph    infer a first-draft declaration from the tree (writes a draft)
  doctor   lint + graph residue + a summary of what needs declaring

  Exit: 0 clean, 1 violations, 2 usage.`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const treeArg = argv[1];
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);

if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(cmd ? 0 : 2); }
if (!treeArg || treeArg.startsWith('-')) { console.error(USAGE); process.exit(2); }

const root = resolve(process.cwd(), treeArg);
if (!existsSync(root)) { console.error(`tresridge: tree not found: ${treeArg}`); process.exit(2); }

const declPath = flag('--decl') || 'relations.json';

try {
  if (cmd === 'lint') {
    if (!existsSync(declPath)) { console.error(`tresridge: declaration not found: ${declPath} (run \`tresridge graph\` to draft one)`); process.exit(2); }
    const decl = JSON.parse(readFileSync(declPath, 'utf8'));
    const declErrors = validateDeclaration(decl);
    if (declErrors.length) {
      for (const e of declErrors) console.error(`  DECL ${e}`);
      process.exit(1);
    }
    const result = lint(readTree(root), decl);
    if (has('--json')) { console.log(JSON.stringify(result, null, 2)); }
    else {
      console.log(`tresridge lint: ${result.families} families, ${result.records} records, ${result.edges} edges`);
      for (const w of result.warnings) console.log(`  WARN  ${w.code}  ${w.record} .${w.field} -> "${w.target || ''}"`);
      for (const v of result.violations) console.log(`  FAIL  ${v.code}  ${v.record}${v.field ? ' .' + v.field : ''}  ${v.detail}`);
      console.log(`  ${result.violations.length} violation(s), ${result.warnings.length} warning(s)`);
    }
    process.exit(result.violations.length ? 1 : 0);
  }

  if (cmd === 'graph') {
    const { declaration, residue, tree } = graph(root);
    const out = flag('--out');
    if (out) writeFileSync(out, JSON.stringify(declaration, null, 2) + '\n');
    if (has('--json')) { console.log(JSON.stringify({ declaration, residue }, null, 2)); }
    else {
      console.log(`tresridge graph: ${tree.families.length} families, ${tree.records.length} records, ${declaration.edges.length} edges inferred`);
      console.log(`  residue: ${residue.undeclared.length} field(s) need declaration`);
      for (const u of residue.undeclared.slice(0, 20)) console.log(`    ${String(u.count).padStart(4)}  ${u.family}.${u.field}`);
      if (out) console.log(`  draft written: ${out}`);
    }
    process.exit(0);
  }

  if (cmd === 'doctor') {
    const { declaration, residue, tree } = graph(root);
    console.log(`tresridge doctor: ${tree.families.length} families, ${tree.records.length} records`);
    console.log(`  edges inferred:  ${declaration.edges.length}`);
    console.log(`  needs declaring: ${residue.undeclared.length} field(s)`);
    if (existsSync(declPath)) {
      const decl = JSON.parse(readFileSync(declPath, 'utf8'));
      const result = lint(readTree(root), decl);
      console.log(`  declared edges:  ${decl.edges.length}`);
      console.log(`  violations:      ${result.violations.length}`);
      console.log(`  warnings:        ${result.warnings.length}`);
      process.exit(result.violations.length ? 1 : 0);
    }
    console.log(`  declaration:     ${declPath} not found (run \`tresridge graph --out ${declPath}\`)`);
    process.exit(0);
  }

  console.error(USAGE); process.exit(2);
} catch (err) {
  console.error(`tresridge: ${err.message}`);
  process.exit(2);
}
