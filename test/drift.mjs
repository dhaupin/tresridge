// The `--against` drift gate: prove it detects drift in BOTH directions, and that
// it stays quiet on a declaration that matches the tree. A gate that only ever
// says "clean" is not a gate.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { graph, diffDeclaration } from '../src/graph.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tresridge-drift-'));
const files = {
  'zones/zn_a.tres': 'script_class="ZoneData"\nid = "zn_a"\nworld_id = "world_a"\n',
  'worlds/world_a.tres': 'script_class="WorldData"\nid = "world_a"\n',
};
for (const [rel, body] of Object.entries(files)) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

const { declaration, residue } = graph(dir);
const fails = [];

// 1. A declaration equal to the inference is clean.
{
  const { added, removed } = diffDeclaration(declaration, declaration, residue);
  if (added.length || removed.length) fails.push(`clean case drifted: +${added.length} -${removed.length}`);
}

// 2. An edge the tree has but the declaration omits is `added`.
{
  const decl = { ...declaration, edges: declaration.edges.filter((e) => e.field !== 'world_id') };
  const { added, removed } = diffDeclaration(declaration, decl, residue);
  if (added.length !== 1 || removed.length) fails.push(`added case: +${added.length} -${removed.length} (want +1 -0)`);
}

// 3. A row naming an edge the tree no longer has is `removed`.
{
  const decl = { ...declaration, edges: [...declaration.edges, { family: 'zones', field: 'ghost_id', target: 'zones', kind: 'ref' }] };
  const { added, removed } = diffDeclaration(declaration, decl, residue);
  if (removed.length !== 1 || added.length) fails.push(`removed case: +${added.length} -${removed.length} (want +0 -1)`);
}

if (fails.length) {
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('  OK    drift gate detects added + removed, and is quiet when clean');
