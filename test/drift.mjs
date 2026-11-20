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
const check = (label, cond, detail) => { if (!cond) fails.push(`${label}  <- ${detail}`); };

// 1. A declaration equal to the inference is clean.
{
  const { added, removed, changed } = diffDeclaration(declaration, declaration, residue);
  check('clean case', !added.length && !removed.length && !changed.length, `+${added.length} -${removed.length} ~${changed.length}`);
}

// 2. An edge the tree has but the declaration omits is `added`.
{
  const decl = { ...declaration, edges: declaration.edges.filter((e) => e.field !== 'world_id') };
  const { added, removed, changed } = diffDeclaration(declaration, decl, residue);
  check('added case', added.length === 1 && !removed.length && !changed.length, `+${added.length} -${removed.length} ~${changed.length} (want +1 -0 ~0)`);
}

// 3. A row naming an edge the tree no longer has is `removed`.
{
  const decl = { ...declaration, edges: [...declaration.edges, { family: 'zones', field: 'ghost_id', target: 'zones', kind: 'ref' }] };
  const { added, removed, changed } = diffDeclaration(declaration, decl, residue);
  check('removed case', removed.length === 1 && !added.length && !changed.length, `+${added.length} -${removed.length} ~${changed.length} (want +0 -1 ~0)`);
}

// 4. A row that exists on both sides but points at the WRONG family is `changed`.
//    This was a real hole: the gate keyed only on `family.field`, so a declaration
//    could retarget an edge at a family that does not hold its ids and still report
//    "0 added, 0 removed". The lint would then enforce the wrong target in silence.
{
  const decl = { ...declaration, edges: declaration.edges.map((e) => (e.field === 'world_id' ? { ...e, target: 'zones' } : e)) };
  const { added, removed, changed } = diffDeclaration(declaration, decl, residue);
  check('retargeted case', changed.length === 1 && !added.length && !removed.length, `+${added.length} -${removed.length} ~${changed.length} (want +0 -0 ~1)`);
  check('retargeted case names both sides', changed[0] && changed[0].declared.target === 'zones' && changed[0].inferred.target === 'worlds', JSON.stringify(changed[0]));
}

// 5. A kind flip on the same (family, field) is `changed`.
{
  const decl = { ...declaration, edges: declaration.edges.map((e) => (e.field === 'world_id' ? { ...e, kind: 'literal' } : e)) };
  const { changed } = diffDeclaration(declaration, decl, residue);
  check('kind-flip case', changed.length === 1 && changed[0].declared.kind === 'literal' && changed[0].inferred.kind === 'ref', JSON.stringify(changed[0]));
}

// 6. A union target that CONTAINS the inferred one is a legitimate human refinement,
//    not drift. The reference deployment relies on this: two of its rows widen a
//    single-family inference to the seven families that actually hold the ids.
{
  const decl = { ...declaration, edges: declaration.edges.map((e) => (e.field === 'world_id' ? { ...e, target: ['zones', 'worlds'] } : e)) };
  const { added, removed, changed } = diffDeclaration(declaration, decl, residue);
  check('union-widening case', !added.length && !removed.length && !changed.length, `+${added.length} -${removed.length} ~${changed.length} (want all 0)`);
}

// 7. A union that OMITS the inferred target is drift: the ids live in `worlds`, and a
//    declaration that only looks in `zones` will refuse every valid reference.
{
  const decl = { ...declaration, edges: declaration.edges.map((e) => (e.field === 'world_id' ? { ...e, target: ['zones'] } : e)) };
  const { changed } = diffDeclaration(declaration, decl, residue);
  check('union-narrowing case', changed.length === 1, JSON.stringify(changed));
}

if (fails.length) {
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('  OK    drift gate detects added + removed + changed, tolerates union widening, and is quiet when clean');
