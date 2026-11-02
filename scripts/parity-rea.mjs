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
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
  timeout: 10 * 60 * 1000,
  windowsHide: true
});

if (result.error) {
  console.error(`Unable to run REA: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.status ?? 1);
}

try {
  const report = JSON.parse(result.stdout);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch {
  console.error('REA did not return valid JSON. Raw output was withheld from stdout; inspect the command diagnostics.');
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}
