// The self-check: run the battery and the drift gate. `npm test`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

console.log('tresridge self-check\n');
console.log('[1/7] refusal battery (observed, never hand-derived)');
run(['scripts/gen-refusal-matrix.mjs']);
console.log('\n[2/7] drift gate (committed column + battery match a fresh run)');
run(['scripts/gen-refusal-matrix.mjs', '--check']);
console.log('\n[3/7] drift gate (--against detects both directions)');
run(['test/drift.mjs']);
console.log('\n[4/7] vocabulary gate (spec table == registry == battery)');
run(['scripts/check-vocabulary.mjs']);
console.log('\n[5/7] CLI battery (the binary, its exit codes, and the contract root)');
run(['test/cli.mjs']);
console.log('\n[6/7] docs gate (published numbers match a measured run)');
run(['scripts/check-docs.mjs']);
console.log('\n[7/7] npm parity gate (every shipped surface links the published package)');
run(['--test', 'test/npm-parity.mjs']);
console.log('\ntresridge: self-check clean.');
