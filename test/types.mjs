// The types battery: the `.d.mts` files must describe the modules they sit beside.
//
// A hand-written declaration file rots in one direction - someone adds an export and
// forgets the types, or removes one and leaves a declaration for a function that no
// longer exists. Neither shows up until a consumer's build breaks, which is the worst
// possible time. This compares the two surfaces directly.
//
// It checks NAMES, not signatures: every runtime export has a declaration and every
// declaration names a real export. That is the drift that actually happens. A wrong
// parameter type still passes here, so this is a floor, not a proof.
//
// No TypeScript dependency: this repo's toolchain is deliberate, and a heavy compiler
// to gate four small files is a bad trade. The files themselves are checked to be
// parseable TypeScript out of band, not on every run.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const fails = [];
let checks = 0;

function check(label, cond, detail = '') {
  checks++;
  if (cond) return;
  fails.push(`${label}${detail ? `  <- ${detail}` : ''}`);
  console.log(`  FAIL  ${label}${detail ? `  <- ${detail}` : ''}`);
}

/**
 * The names a `.d.mts` file declares, ignoring anything inside a comment.
 *
 * Split in two because they are checked differently: `value` names (`declare function`
 * / `declare const`) must exist at runtime, while `type` names (`interface` / `type`)
 * are erased and must not be required there.
 */
function declaredNames(dts) {
  const src = dts
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const values = new Set();
  const types = new Set();
  for (const m of src.matchAll(/export\s+declare\s+function\s+([A-Za-z_$][\w$]*)/g)) values.add(m[1]);
  for (const m of src.matchAll(/export\s+declare\s+const\s+([A-Za-z_$][\w$]*)/g)) values.add(m[1]);
  for (const m of src.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*)/g)) types.add(m[1]);
  for (const m of src.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)/g)) types.add(m[1]);
  return { values, types };
}

/** The names a module actually exports at runtime. */
async function runtimeNames(file) {
  const mod = await import(pathToFileURL(file).href);
  return new Set(Object.keys(mod));
}

// --- each declared module is described by a declaration file that matches it -------
const PAIRS = [
  ['lint.mjs', 'lint.d.mts'],
  ['graph.mjs', 'graph.d.mts'],
  ['rules.mjs', 'rules.d.mts'],
  ['tres.mjs', 'tres.d.mts'],
];

for (const [js, dts] of PAIRS) {
  const jsPath = join(SRC, js);
  const dtsPath = join(SRC, dts);
  check(`${dts} exists beside ${js}`, existsSync(dtsPath), 'missing declaration file');
  if (!existsSync(dtsPath)) continue;

  const runtime = await runtimeNames(jsPath);
  const { values } = declaredNames(readFileSync(dtsPath, 'utf8'));

  for (const name of runtime) {
    check(`${js}: "${name}" is declared in ${dts}`, values.has(name), 'exported but not typed');
  }
  // Every declared VALUE must exist. A declared TYPE need not: interfaces are erased,
  // and demanding they exist at runtime would push authors to delete useful types.
  for (const name of values) {
    check(`${dts}: "${name}" exists in ${js}`, runtime.has(name), 'declared but not exported');
  }
}

// --- the package points at them -----------------------------------------------------
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  check('the package declares a types entry', typeof pkg.types === 'string', 'no types field');
  if (typeof pkg.types === 'string') {
    check('the types entry exists', existsSync(join(ROOT, pkg.types)), pkg.types);
  }

  // Every subpath a consumer can import needs a declaration beside its target, or
  // `import 'tresridge/graph'` type-checks as `any` and the map is only half real.
  for (const [sub, val] of Object.entries(pkg.exports || {})) {
    if (sub.includes('*')) continue;
    const rel = typeof val === 'string' ? val : val.default;
    if (typeof rel !== 'string') continue;
    // The declaration is either declared explicitly or sits beside the target.
    const explicit = typeof val === 'object' && typeof val.types === 'string' ? val.types : null;
    const dts = explicit || rel.replace(/\.mjs$/, '.d.mts');
    check(`subpath "${sub}" has a declaration`, existsSync(join(ROOT, dts)), `${dts} missing`);
  }

  // `files` must ship them: a declaration that is not in the tarball is a types entry
  // pointing at nothing.
  check('src/ is shipped, so the declarations publish', (pkg.files || []).includes('src'), JSON.stringify(pkg.files));
}

// --- a declaration cannot claim a symbol the package refuses to expose --------------
{
  // `exports` is the API. A type file describing internals would invite imports the
  // map then blocks, so the root declaration must not name `src/` paths.
  const lintDts = readFileSync(join(SRC, 'lint.d.mts'), 'utf8');
  check('the root declaration does not re-export a src/ path', !/from\s+['"]\.\/src\//.test(lintDts), 'src/ path in types');
}

if (fails.length) {
  console.error(`\n  REFUSED: ${fails.length} of ${checks} type check(s) failed.`);
  process.exit(1);
}
console.log(`  ${checks} type check(s) honest.`);
