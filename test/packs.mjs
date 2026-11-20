// The pack battery: prove the packstruct layer from both sides.
//
// tresridge is a packstruct HOST (it loads packs and runs their checks) and a
// pack PRODUCER (packs/public/ ships one). Both claims are only worth what they
// can refuse, so every case here drives the real binary or the real loader over
// real bytes in a temp dir. Nothing is mocked.
//
//   - the loader's manifest refusals, each naming the pack (SPEC section 5)
//   - relevance: a pack whose `requires` the root does not provide skips by
//     name, and `ignore` wins over relevance (SPEC section 8, v1.3.0)
//   - `--packs` merges a pack's vocabulary, so its codes are legal
//   - a pack rule's finding carries the pack name
//   - `lint-packs` refuses an invented code, a duplicate id, and a declared
//     armedCoverage row that does not ship
//   - the shipped pack passes its own armed row
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackDir, collectPacks, isRelevant, vocabularyOf, checksOf } from '../src/packs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.mjs');

const fails = [];
let checks = 0;
const check = (label, ok, detail) => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` - ${detail}` : ''}`);
};

function cli(args, cwd = ROOT) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

function node(args, cwd = ROOT) {
  try {
    const out = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

const dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'tresridge-packs-'));
  dirs.push(d);
  return d;
}

// Materialize a pack dir from a manifest + entry source. `root` is the packs
// root it sits under (public/ is the family's directory contract).
function makePack({ root, name, manifest = {}, entry = 'export default { checks: [] }\n', extra = {} }) {
  const dir = join(root, 'public', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({
    schemaVersion: 1, name, description: 'a test pack', version: '1.0.0', entry: 'index.mjs', ...manifest,
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'index.mjs'), entry);
  for (const [rel, body] of Object.entries(extra)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
  }
  return dir;
}

// A .tres tree with one family whose records do or do not declare an id.
function makeTree(records) {
  const root = tmp();
  mkdirSync(join(root, 'npcs'), { recursive: true });
  writeFileSync(join(root, 'relations.json'), JSON.stringify({
    schemaVersion: 1, families: [{ key: 'npcs', schema: 'NpcData', idPrefix: 'npc_' }], edges: [],
  }, null, 2) + '\n');
  for (const [file, body] of Object.entries(records)) writeFileSync(join(root, 'npcs', file), body);
  return root;
}

try {
  // --- the shipped pack ------------------------------------------------------
  {
    const pack = await loadPackDir(join(ROOT, 'packs', 'public', 'godot-shapes'), 'packs/godot-shapes');
    check('the shipped pack loads through the loader', pack.name === 'godot-shapes', pack.name);
    check('the shipped pack declares its checks', checksOf(pack).length === 1, String(checksOf(pack).length));
    check('the shipped pack carries implements packstruct@1', pack.spec.implements === 'packstruct@1', pack.spec.implements);
    const vocab = vocabularyOf(pack);
    check('the shipped pack vocabulary is readable', vocab.includes('godot/id-required-when-prefixed'), JSON.stringify(vocab));
    check('every shipped check code is in the pack vocabulary',
      checksOf(pack).every((c) => vocab.includes(c.code)),
      JSON.stringify(checksOf(pack).map((c) => c.code)));

    const r = cli(['lint-packs', 'packs/public', '--deep', '--json']);
    check('lint-packs --deep passes the shipped pack', r.code === 0, r.err || r.out);
    const parsed = JSON.parse(r.out);
    check('lint-packs reports the pack as checked', parsed.packsChecked === 1, String(parsed.packsChecked));
  }

  // --- manifest refusals, each naming the pack -------------------------------
  {
    const cases = [
      ['name', { name: 'Wrong-Name' }, /kebab-case/],
      ['name-dir-match', { name: 'other-pack' }, /does not match the directory name/],
      ['schema', { schemaVersion: 2 }, /schemaVersion must be 1/],
      ['version', { version: 'nope' }, /dotted semver/],
      ['description', { description: '   ' }, /non-empty string/],
      ['entry', { entry: '../escape.mjs' }, /relative path inside the pack dir/],
      ['requires', { requires: 'tres-tree' }, /array of kebab-case/],
      ['requires-token', { requires: ['Tres_Tree'] }, /kebab-case/],
      ['requires-dupe', { requires: ['tres-tree', 'tres-tree'] }, /repeats the token/],
    ];
    for (const [label, patch, re] of cases) {
      const root = tmp();
      const dir = makePack({ root, name: 'probe', manifest: patch });
      let err = null;
      try { await loadPackDir(dir, 'packs/probe'); } catch (e) { err = e.message; }
      check(`manifest refusal: ${label}`, err !== null && re.test(err), err || 'loaded clean');
      check(`manifest refusal names the pack: ${label}`, err !== null && /probe/.test(err), err || '');
    }
    const root = tmp();
    const dir = makePack({ root, name: 'probe', manifest: { entry: 'missing.mjs' } });
    let err = null;
    try { await loadPackDir(dir, 'packs/probe'); } catch (e) { err = e.message; }
    check('manifest refusal: entry file absent', err !== null && /does not exist in the pack dir/.test(err), err || 'loaded clean');
  }

  // --- relevance (SPEC v1.3.0) ----------------------------------------------
  {
    check('a pack requiring nothing is always relevant', isRelevant({ name: 'p', requires: [] }, {}).relevant === true);
    check('a pack is relevant when the root provides its tokens',
      isRelevant({ name: 'p', requires: ['tres-tree'] }, { provides: ['tres-tree'] }).relevant === true);
    const unmet = isRelevant({ name: 'p', requires: ['wordpress'] }, { provides: ['tres-tree'] });
    check('a pack skips when the root does not provide its token', unmet.relevant === false, JSON.stringify(unmet));
    check('the skip names the unmet token', /wordpress/.test(unmet.detail), unmet.detail);
    const ignored = isRelevant({ name: 'p', requires: [] }, { ignore: ['p'] });
    check('ignore wins over relevance', ignored.relevant === false && ignored.reason === 'ignore', JSON.stringify(ignored));
    check('a root declaring nothing loads every pack', isRelevant({ name: 'p', requires: ['anything'] }, {}).relevant === true);

    // Through the loader: a skipped pack is REPORTED, never silently dropped.
    const root = tmp();
    makePack({ root, name: 'needs-wp', manifest: { requires: ['wordpress'] } });
    makePack({ root, name: 'needs-tres', manifest: { requires: ['tres-tree'] } });
    const result = await collectPacks({ root: join(root, 'public'), runRoot: { provides: ['tres-tree'] } });
    check('the loader loads only the relevant pack', result.packs.length === 1 && result.packs[0].name === 'needs-tres',
      JSON.stringify(result.packs.map((p) => p.name)));
    check('the loader reports the skipped pack by name', result.skipped.length === 1 && result.skipped[0].name === 'needs-wp',
      JSON.stringify(result.skipped));
  }

  // --- --packs merges vocabulary and names the pack on a finding ------------
  {
    const root = tmp();
    makePack({
      root, name: 'prefix-law',
      manifest: { vocabulary: 'refusals.json', adds: ['prefix-law/id-required'] },
      extra: { 'refusals.json': { schemaVersion: 1, codes: [{ code: 'prefix-law/id-required', severity: 'violation', detail: 'x' }] } },
      entry: `export const checks = [{
        id: 'prefix-law/id-required',
        code: 'prefix-law/id-required',
        severity: 'violation',
        scope: 'tree',
        run(ctx) {
          return ctx.tree.records.filter((r) => !r.idDeclared).map((r) => ({ code: 'prefix-law/id-required', record: r.file, detail: 'no id line' }));
        },
      }];
      export default { checks };
      `,
    });
    const tree = makeTree({ 'blacksmith.tres': 'script_class="NpcData"\ndisplay_name = "x"\n' });

    const withPack = cli(['lint', tree, '--packs', join(root, 'public'), '--json']);
    check('a pack code is legal once the pack is armed', withPack.code === 1, withPack.err || withPack.out);
    const parsed = JSON.parse(withPack.out);
    const hit = parsed.violations.find((v) => v.code === 'prefix-law/id-required');
    check('the pack rule fired', Boolean(hit), JSON.stringify(parsed.violations));
    check('the finding names the pack', hit && hit.pack === 'prefix-law', hit && hit.pack);

    // The same rule armed with no vocabulary would be an invented code.
    const noVocabRoot = tmp();
    makePack({
      root: noVocabRoot, name: 'invented',
      entry: `export const checks = [{ code: 'invented/nope', severity: 'violation', scope: 'tree', run() { return []; } }];\n`,
    });
    const invented = cli(['lint', tree, '--packs', join(noVocabRoot, 'public'), '--json']);
    const invParsed = JSON.parse(invented.out);
    check('a pack rule with an invented code is refused', invParsed.violations.some((v) => v.code === 'unknown-rule'),
      JSON.stringify(invParsed.violations));
    check('the invented-code refusal names the pack',
      invParsed.violations.some((v) => v.code === 'unknown-rule' && v.pack === 'invented'),
      JSON.stringify(invParsed.violations));
  }

  // --- lint-packs refusals ---------------------------------------------------
  {
    const root = tmp();
    makePack({
      root, name: 'dup-ids',
      entry: `export const checks = [
        { id: 'dup/x', code: 'dup/x', severity: 'violation', scope: 'tree', run() { return []; } },
        { id: 'dup/x', code: 'dup/y', severity: 'violation', scope: 'tree', run() { return []; } },
      ];\n`,
      manifest: { vocabulary: 'refusals.json' },
      extra: { 'refusals.json': { codes: [{ code: 'dup/x' }, { code: 'dup/y' }] } },
    });
    const r = cli(['lint-packs', join(root, 'public'), '--deep', '--json']);
    const parsed = JSON.parse(r.out);
    check('lint-packs refuses a duplicate check id', parsed.violations.some((v) => v.code === 'id-duplicate'), r.out);
    check('the duplicate refusal names the pack', parsed.violations.some((v) => v.code === 'id-duplicate' && v.pack === 'dup-ids'), r.out);

    const root2 = tmp();
    makePack({ root: root2, name: 'no-armed', manifest: { armedCoverage: 'test/fixtures/run.mjs' } });
    const r2 = cli(['lint-packs', join(root2, 'public'), '--deep', '--json']);
    const p2 = JSON.parse(r2.out);
    check('lint-packs refuses a declared armedCoverage that does not ship',
      p2.violations.some((v) => v.code === 'armed-coverage'), r2.out);

    const root3 = tmp();
    makePack({ root: root3, name: 'no-checks', entry: 'export default { name: "no-checks" }\n' });
    const r3 = cli(['lint-packs', join(root3, 'public'), '--json']);
    const p3 = JSON.parse(r3.out);
    check('lint-packs refuses a pack that audits nothing', p3.violations.some((v) => v.code === 'no-checks'), r3.out);

    const root4 = tmp();
    makePack({ root: root4, name: 'collides' });
    const r4 = cli(['lint-packs', join(root4, 'public'), '--json']);
    check('a pack with no vocabulary but no checks is refused for the missing checks, not silently passed',
      r4.code === 1, r4.out);
  }

  // --- the shipped pack's armed row -----------------------------------------
  {
    const r = node([join(ROOT, 'packs', 'public', 'godot-shapes', 'test', 'fixtures', 'run.mjs')]);
    check('the shipped pack armed row passes', r.code === 0, r.err);
    check('the armed row reports what it fired', /armed row fired 1/.test(r.out), r.out);

    const manifest = JSON.parse(readFileSync(join(ROOT, 'packs', 'public', 'godot-shapes', 'pack.json'), 'utf8'));
    check('the shipped pack declares armedCoverage', manifest.armedCoverage === 'test/fixtures/run.mjs', manifest.armedCoverage);
    check('the shipped pack declares requires', Array.isArray(manifest.requires) && manifest.requires.includes('tres-tree'),
      JSON.stringify(manifest.requires));
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n  REFUSED: ${fails.length} of ${checks} pack check(s) failed.`);
  for (const f of fails) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`  ${checks} pack check(s) honest.`);
