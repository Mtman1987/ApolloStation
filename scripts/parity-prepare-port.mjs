import fs from 'node:fs';
import path from 'node:path';

const [comparisonPath, capabilitiesPath, outputDir = 'port-brief'] = process.argv.slice(2);
if (!comparisonPath || !capabilitiesPath) {
  console.error('Usage: node scripts/parity-prepare-port.mjs <comparison.json> <capabilities.json> [output-dir]');
  process.exit(2);
}
const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const comparison = read(comparisonPath);
const capabilities = read(capabilitiesPath);
if (!comparison.provenance?.donor?.repository || !Array.isArray(comparison.donorOnlyPaths) || !Array.isArray(capabilities.products)) {
  console.error('Comparison provenance/donorOnlyPaths or capability products are missing.');
  process.exit(2);
}
const donor = comparison.provenance.donor;
const apollo = comparison.provenance.apollo ?? {};
const product = capabilities.products.find(item => item.appPath === apollo.appPath) ??
  capabilities.products.find(item => item.id === donor.id || item.name?.toLowerCase().replaceAll(' ', '-') === donor.id);
const owner = product?.id ?? 'unmapped';
const knownGaps = product?.knownGaps ?? ['Map donor capabilities to an Apollo owner and acceptance criteria'];
const donorCommit = donor.commit ?? donor.ref ?? 'unknown-ref';
const donorRepo = donor.repository;
const sourceUrl = p => `https://github.com/${donorRepo}/blob/${donorCommit}/${p}`;
const candidates = comparison.donorOnlyPaths.map(file => ({
  path: file, sourceUrl: sourceUrl(file), owner, priority: product?.priority ?? 'unclassified',
  confidence: 'low', status: 'candidate-only-not-proof',
  reason: 'Donor-only path under normalized inventory comparison; renamed or differently structured Apollo implementation may already exist.',
  reviewRequired: true
}));
const brief = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  provenance: { donorRepository: donorRepo, donorCommit, apolloRepository: 'Mtman1987/ApolloStation', apolloCommit: apollo.commit ?? apollo.ref ?? 'unknown', appPath: apollo.appPath ?? null },
  classification: { productId: owner, priority: product?.priority ?? 'unclassified', capabilityStatus: product?.status ?? 'unknown', knownGaps, confidence: product ? 'medium-for-gap-list-low-for-path-mapping' : 'low', reviewRequired: true },
  inventorySummary: comparison.summary,
  donorOnlyCandidates: candidates,
  portTasks: knownGaps.map((gap, index) => ({
    id: `${owner}-gap-${index + 1}`, capability: gap, priority: product?.priority ?? 'unclassified',
    sourceEvidence: product?.sourceDocs ?? [], existingApolloEvidence: product?.evidence ?? [],
    acceptance: ['identify donor implementation and behavior', 'map to Apollo owner/API and tenant authorization', 'add focused automated tests', 'exercise two-tenant isolation and restart/restore where stateful', 'record live acceptance separately'],
    status: 'needs-triage', reviewRequired: true
  })),
  guardrails: ['Inventory/path similarity is not proof of missing capability or parity.', 'Donor code is read-only and never executed by this generator.', 'Do not copy secrets, donor credentials, or donor deployment assumptions.', 'No task is auto-approved or auto-merged; owner and security review are required.']
};
fs.mkdirSync(path.resolve(outputDir), {recursive:true});
fs.writeFileSync(path.join(path.resolve(outputDir), 'port-brief.json'), JSON.stringify(brief, null, 2) + '\n');
const md = [
  '# Automated Apollo port brief', '',
  `- Donor: ${donorRepo}@${donorCommit}`,
  `- Apollo: ${brief.provenance.apolloCommit} (${brief.provenance.appPath ?? 'app not specified'})`,
  `- Owner/product: ${owner}; priority: ${brief.classification.priority}; status: ${brief.classification.capabilityStatus}`,
  `- Confidence: ${brief.classification.confidence}; review required: yes`, '',
  '## Known capability gaps (triage queue)', '',
  ...brief.portTasks.map(task => `- [ ] **${task.priority} · ${task.capability}** — ${task.id}`),
  '', '## Donor-only source candidates (not proof of missing features)', '',
  ...(candidates.length ? candidates.map(item => `- [${item.path}](${item.sourceUrl}) — ${item.status}; review required`) : ['- None detected by normalized path comparison.']),
  '', '## Required acceptance for every port', '', ...brief.portTasks.flatMap(task => task.acceptance.map(item => `- ${item}`)).filter((item, index, all) => all.indexOf(item) === index),
  '', '## Guardrails', '', ...brief.guardrails.map(item => `- ${item}`), ''
].join('\n');
fs.writeFileSync(path.join(path.resolve(outputDir), 'port-brief.md'), md);
console.log(`Prepared ${brief.portTasks.length} capability tasks and ${candidates.length} source candidates; review required.`);
