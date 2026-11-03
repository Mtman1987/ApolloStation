import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--') || !process.argv[i + 1]) {
    console.error('Usage: node scripts/parity-donor-inventory.mjs --root <path> --repository <owner/name> --ref <ref> --output <file>');
    process.exit(2);
  }
  args.set(key.slice(2), process.argv[++i]);
}

const root = path.resolve(args.get('root') ?? '');
const repository = args.get('repository');
const ref = args.get('ref');
const appPath = args.get('app-path');
const output = path.resolve(args.get('output') ?? 'donor-inventory.json');
const repositoryParts = typeof repository === 'string' ? repository.split('/') : [];
const validRepository = repositoryParts.length === 2 && repositoryParts.every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');
if (!args.get('root') || !validRepository || !ref) {
  console.error('A root, valid owner/name repository, and ref are required.');
  process.exit(2);
}
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Donor source directory does not exist: ${root}`);
  process.exit(2);
}

const excludedDirectory = new Set([
  '.git', 'node_modules', '.next', '.nuxt', 'dist', 'build', 'coverage',
  '.cache', '.turbo', '.venv', 'venv', '__pycache__'
]);
const excludedName = /(^\.env($|\.)|(^|\.)pem$|(^|\.)key$|\.p12$|\.pfx$|id_rsa|id_ed25519|credentials|secrets?)/i;
const maxFileBytes = 2 * 1024 * 1024;
const maxFiles = 50000;
const files = [];
const skipped = { excluded: 0, oversized: 0, symlinks: 0, beyondLimit: 0 };

function walk(directory, relative = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { skipped.symlinks += 1; continue; }
    if (entry.isDirectory()) {
      if (excludedDirectory.has(entry.name) || excludedName.test(entry.name)) {
        skipped.excluded += 1;
        continue;
      }
      walk(full, rel);
      continue;
    }
    if (!entry.isFile()) continue;
    if (excludedName.test(entry.name)) { skipped.excluded += 1; continue; }
    const stat = fs.statSync(full);
    if (stat.size > maxFileBytes) { skipped.oversized += 1; continue; }
    if (files.length >= maxFiles) { skipped.beyondLimit += 1; continue; }
    const bytes = fs.readFileSync(full);
    if (bytes.includes(0)) { skipped.excluded += 1; continue; }
    files.push({
      path: rel.split(path.sep).join('/'),
      bytes: stat.size,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      extension: path.extname(entry.name).toLowerCase() || '[none]'
    });
  }
}

walk(root);
const extensions = {};
for (const file of files) extensions[file.extension] = (extensions[file.extension] ?? 0) + 1;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  provenance: {
    repository,
    ref,
    ...(appPath ? { appPath } : {}),
    commit: process.env.DONOR_COMMIT_SHA ?? null,
    inventoryOnly: true,
    donorCodeExecuted: false
  },
  summary: {
    filesInventoried: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    extensions,
    skipped
  },
  files
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Inventoried ${files.length} donor files from ${repository}@${ref}; donor code was not executed.`);
