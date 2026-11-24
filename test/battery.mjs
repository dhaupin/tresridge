// The self-check: run the battery and the drift gate. `npm test`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

console.log('tresridge self-check\n');
console.log('[1/6] refusal battery (observed, never hand-derived)');
run(['scripts/gen-refusal-matrix.mjs']);
console.log('\n[2/6] drift gate (committed column + battery match a fresh run)');
run(['scripts/gen-refusal-matrix.mjs', '--check']);
console.log('\n[3/6] drift gate (--against detects both directions)');
run(['test/drift.mjs']);
console.log('\n[4/6] vocabulary gate (spec table == registry == battery)');
run(['scripts/check-vocabulary.mjs']);
console.log('\n[5/6] CLI battery (the binary, its exit codes, and the contract root)');
run(['test/cli.mjs']);
console.log('\n[6/6] docs gate (published numbers match a measured run)');
run(['scripts/check-docs.mjs']);
console.log('\ntresridge: self-check clean.');
