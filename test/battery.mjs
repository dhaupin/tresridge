// The self-check: run the battery and the drift gate. `npm test`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

console.log('tresridge self-check\n');
console.log('[1/3] refusal battery (observed, never hand-derived)');
run(['scripts/gen-refusal-matrix.mjs']);
console.log('\n[2/3] drift gate (committed column + battery match a fresh run)');
run(['scripts/gen-refusal-matrix.mjs', '--check']);
console.log('\n[3/3] vocabulary gate (spec table == registry == battery)');
run(['scripts/check-vocabulary.mjs']);
console.log('\ntresridge: self-check clean.');
