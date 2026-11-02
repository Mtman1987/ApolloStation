import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'config/apollo-parity-capabilities.v1.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const allowed = new Set(Object.keys(registry.statusDefinitions));
const errors = [];
const exists = (p) => fs.existsSync(path.join(root, p));

function validateReferences(owner, fields) {
  for (const field of fields) {
    if (!Array.isArray(owner[field])) {
      errors.push(`${owner.id}: ${field} must be an array`);
      continue;
    }
    for (const file of owner[field]) if (!exists(file)) errors.push(`${owner.id}: referenced path does not exist: ${file}`);
  }
}

if (registry.schemaVersion !== 1) errors.push('Unsupported product registry schemaVersion');
if (!Array.isArray(registry.products) || registry.products.length === 0) errors.push('products must be a non-empty array');
const productIds = new Set();
for (const product of registry.products ?? []) {
  if (!product.id || productIds.has(product.id)) errors.push(`Missing or duplicate product id: ${product.id ?? '(empty)'}`);
  productIds.add(product.id);
  if (!allowed.has(product.status)) errors.push(`${product.id}: invalid status "${product.status}"`);
  if (!exists(product.appPath)) errors.push(`${product.id}: appPath does not exist: ${product.appPath}`);
  validateReferences(product, ['sourceDocs', 'evidence', 'knownGaps']);
}

const detailPath = path.join(root, 'config/hearmeout-parity-capabilities.v1.json');
let detail;
if (!fs.existsSync(detailPath)) errors.push('Missing HearMeOut capability ledger');
else {
  detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
  if (detail.schemaVersion !== 1 || detail.product !== 'hearmeout') errors.push('Unsupported HearMeOut capability ledger schema or product');
  const capabilityIds = new Set();
  for (const capability of detail.capabilities ?? []) {
    if (!capability.id || capabilityIds.has(capability.id)) errors.push(`Missing or duplicate capability id: ${capability.id ?? '(empty)'}`);
    capabilityIds.add(capability.id);
    if (!allowed.has(capability.status)) errors.push(`${capability.id}: invalid status "${capability.status}"`);
    validateReferences(capability, ['apollo', 'tests', 'acceptance', 'open']);
    if (!Array.isArray(capability.donor)) errors.push(`${capability.id}: donor must be an array`);
    if (!Array.isArray(capability.decisions ?? [])) errors.push(`${capability.id}: decisions must be an array when present`);
  }
  if (!Array.isArray(detail.capabilities) || detail.capabilities.length === 0) errors.push('HearMeOut capabilities must be a non-empty array');
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
console.log('## HearMeOut capability ledger');
if (detail) {
  const capabilityCounts = Object.fromEntries([...allowed].map(status => [status, 0]));
  console.log('| ID | Capability | Status | Priority | Open gaps |');
  console.log('|---|---|---|---:|---:|');
  for (const c of detail.capabilities) {
    capabilityCounts[c.status] = (capabilityCounts[c.status] ?? 0) + 1;
    console.log(`| ${c.id} | ${c.name} | ${c.status} | ${c.priority} | ${c.open?.length ?? 0} |`);
  }
  console.log('');
  console.log('### HearMeOut status counts');
  for (const [status, count] of Object.entries(capabilityCounts)) if (count) console.log(`- ${status}: ${count}`);
  console.log('');
  console.log('### Highest-priority open acceptance');
  for (const c of detail.capabilities.filter(x => x.priority === 'P0' && (x.open?.length ?? 0))) {
    console.log(`#### ${c.id} ${c.name}`);
    for (const gap of c.open) console.log(`- [ ] ${gap}`);
  }
}
console.log('');
console.log('## Product-level open gaps');
for (const p of registry.products ?? []) if (p.knownGaps?.length) {
  console.log(`### ${p.name}`);
  for (const gap of p.knownGaps) console.log(`- [ ] ${gap}`);
}
if (errors.length) {
  console.error('\nRegistry validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('\nProduct and capability registries plus all referenced paths are valid. This is an inventory check, not a parity pass.');
}
