import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'config/apollo-parity-capabilities.v1.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const allowed = new Set(Object.keys(registry.statusDefinitions));
const errors = [];
const seen = new Set();
const exists = (p) => fs.existsSync(path.join(root, p));

if (registry.schemaVersion !== 1) errors.push('Unsupported schemaVersion');
if (!Array.isArray(registry.products) || registry.products.length === 0) errors.push('products must be a non-empty array');

for (const product of registry.products ?? []) {
  if (!product.id || seen.has(product.id)) errors.push(`Missing or duplicate product id: ${product.id ?? '(empty)'}`);
  seen.add(product.id);
  if (!allowed.has(product.status)) errors.push(`${product.id}: invalid status "${product.status}"`);
  if (!exists(product.appPath)) errors.push(`${product.id}: appPath does not exist: ${product.appPath}`);
  for (const field of ['sourceDocs', 'evidence', 'knownGaps']) {
    if (!Array.isArray(product[field])) errors.push(`${product.id}: ${field} must be an array`);
  }
  for (const file of [...(product.sourceDocs ?? []), ...(product.evidence ?? [])]) {
    if (!exists(file)) errors.push(`${product.id}: referenced file does not exist: ${file}`);
  }
}

const counts = Object.fromEntries([...allowed].map(status => [status, 0]));
for (const product of registry.products ?? []) counts[product.status] = (counts[product.status] ?? 0) + 1;
console.log('# Apollo parity inventory');
console.log(`Registry: config/apollo-parity-capabilities.v1.json | Updated: ${registry.updatedAt}`);
console.log('');
console.log('| Product | Status | Priority | Open gaps |');
console.log('|---|---|---:|---:|');
for (const p of registry.products ?? []) console.log(`| ${p.name} | ${p.status} | ${p.priority} | ${p.knownGaps?.length ?? 0} |`);
console.log('');
console.log('## Status counts');
for (const [status, count] of Object.entries(counts)) if (count) console.log(`- ${status}: ${count}`);
console.log('');
console.log('## Open gaps');
for (const p of registry.products ?? []) if (p.knownGaps?.length) {
  console.log(`### ${p.name}`);
  for (const gap of p.knownGaps) console.log(`- [ ] ${gap}`);
}
if (errors.length) {
  console.error('\nRegistry validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('\nRegistry structure and all referenced paths are valid. This is an inventory check, not a parity pass.');
}
