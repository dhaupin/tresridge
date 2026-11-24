// Self-audit fixture for the godot-shapes pack (SPEC section 4, and the
// armedCoverage row packstruct section 8.6 makes nameable).
//
// Hand-invocable: `node packs/public/godot-shapes/test/fixtures/run.mjs`. It
// imports the REAL module from ../index.mjs (the manifest entry) and pins:
//   - the manifest contract (schemaVersion / name / entry / implements)
//   - the declared vocabulary matches the codes the checks actually carry
//   - the rule fires on a record that leans on its filename, and stays quiet
//     on one that declares its id - an armed row, not a shape check
// It never imports the host's internals: a pack is loaded through its manifest.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = dirname(dirname(here));

const EXPECTED_CODES = ['godot/id-required-when-prefixed'];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`godot-shapes: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'godot-shapes') throw new Error(`godot-shapes: manifest name "${manifest.name}" does not match directory`);
  if (manifest.implements !== 'packstruct@1') throw new Error(`godot-shapes: manifest "implements" is ${JSON.stringify(manifest.implements)}, expected "packstruct@1"`);

  const entryPath = join(packDir, manifest.entry);
  const mod = await import(pathToFileURL(entryPath).href);
  const checks = mod.checks ?? mod.default?.checks;
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('godot-shapes: entry module exposes no checks array');

  const codes = checks.map((c) => c.code);
  if (codes.length !== EXPECTED_CODES.length) throw new Error(`godot-shapes: expected ${EXPECTED_CODES.length} checks, module exposes ${codes.length}`);
  for (const code of EXPECTED_CODES) {
    if (!codes.includes(code)) throw new Error(`godot-shapes: documented check missing from module: ${code}`);
  }

  const vocab = JSON.parse(await readFile(join(packDir, manifest.vocabulary), 'utf8'));
  const declared = (vocab.codes ?? []).map((c) => c.code);
  const undeclared = codes.filter((c) => !declared.includes(c));
  if (undeclared.length) throw new Error(`godot-shapes: check codes absent from the declared vocabulary: ${undeclared.join(', ')}`);

  // Armed: drive the rule over two records, one leaning on its filename and one
  // declaring its id. A rule that never fires is not coverage.
  const rule = checks.find((c) => c.code === EXPECTED_CODES[0]);
  const fam = { key: 'npc', idPrefix: 'npc_' };
  const ctx = {
    declFamily: new Map([['npc', fam]]),
    tree: { records: [
      { family: 'npc', file: 'npc/blacksmith.tres', idDeclared: false },
      { family: 'npc', file: 'npc/gardsman.tres', idDeclared: true },
    ] },
  };
  const findings = rule.run(ctx) ?? [];
  if (findings.length !== 1) throw new Error(`godot-shapes: rule fired ${findings.length} times over the armed pair, expected 1`);
  if (findings[0].code !== EXPECTED_CODES[0]) throw new Error(`godot-shapes: rule emitted ${findings[0].code}, expected ${EXPECTED_CODES[0]}`);
  if (!String(findings[0].detail).includes('idPrefix')) throw new Error('godot-shapes: finding detail does not name the idPrefix that caused it');

  return { pack: 'godot-shapes', checks: codes.length, fired: findings.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  audit().then((r) => console.log(`  ${r.pack}: ${r.checks} check(s), armed row fired ${r.fired}`)).catch((err) => { console.error(`  FAIL ${err.message}`); process.exit(1); });
}
