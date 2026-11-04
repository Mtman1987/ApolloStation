import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('Usage: npm run parity:rea -- <path-to-authorized-app-or-artifact>');
  process.exit(2);
}

const target = path.resolve(process.cwd(), targetArg);
let stat;
try {
  stat = fs.statSync(target);
} catch {
  console.error(`REA target does not exist: ${target}`);
  process.exit(2);
}
if (!stat.isDirectory() && !stat.isFile()) {
  console.error(`REA target must be a file or directory: ${target}`);
  process.exit(2);
}

const [major, minor] = process.versions.node.split('.').map(Number);
const supported = (major === 22 && minor >= 19) ||
  (major === 24 && minor >= 11) || major >= 26;
if (!supported) {
  console.error(`REA requires Node 22.19+, 24.11+, or 26+; found ${process.versions.node}`);
  process.exit(2);
}

console.error(`REA static analysis target: ${target}`);
console.error('The target is analyzed as data; this wrapper does not launch the target application.');
const result = spawnSync('npx', [
  '--yes',
  'rea-agents@latest',
  'analyze-javascript-application',
  target,
  '--json'
], {
  // Stream full Evidence to stdout so the workflow can redirect it to an artifact.
  // REA reports can exceed the old 50 MiB in-memory buffer limit.
  stdio: 'inherit',
  timeout: 10 * 60 * 1000,
  windowsHide: true
});

if (result.error) {
  console.error(`Unable to run REA: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
