import fs from 'node:fs';
import path from 'node:path';

const [donorPath, apolloPath, outputPath = 'parity-comparison.json'] = process.argv.slice(2);
if (!donorPath || !apolloPath) {
  console.error('Usage: node scripts/parity-compare-inventories.mjs <donor-inventory.json> <apollo-inventory.json> [output.json]');
  process.exit(2);
}
const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const donor = read(donorPath);
const apollo = read(apolloPath);
if (!Array.isArray(donor.files) || !Array.isArray(apollo.files)) {
  console.error('Both inventories must contain a files array.');
  process.exit(2);
}
const norm = value => value.toLowerCase().replace(/\\/g, '/').replace(/(^|\/)(src|source|lib|app|apps)\//g, '$1');
const apolloByPath = new Map(apollo.files.map(file => [norm(file.path), file]));
const donorByPath = new Map(donor.files.map(file => [norm(file.path), file]));
const exact = [];
const donorOnly = [];
const apolloOnly = [];
for (const [key, file] of donorByPath) {
  const counterpart = apolloByPath.get(key);
  if (counterpart) exact.push({ donor: file.path, apollo: counterpart.path, sameContent: file.sha256 === counterpart.sha256 });
  else donorOnly.push(file.path);
}
for (const [key, file] of apolloByPath) if (!donorByPath.has(key)) apolloOnly.push(file.path);
const extensions = files => files.reduce((acc, file) => {
  const ext = file.extension || path.extname(file.path) || '[none]';
  acc[ext] = (acc[ext] || 0) + 1;
  return acc;
}, {});
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  provenance: { donor: donor.provenance, apollo: apollo.provenance },
  summary: {
    donorFiles: donor.files.length,
    apolloFiles: apollo.files.length,
    exactPathMatches: exact.length,
    exactContentMatches: exact.filter(item => item.sameContent).length,
    donorOnlyPaths: donorOnly.length,
    apolloOnlyPaths: apolloOnly.length
  },
  extensionCounts: { donor: extensions(donor.files), apollo: extensions(apollo.files) },
  exactPathMatches: exact,
  donorOnlyPaths: donorOnly,
  apolloOnlyPaths: apolloOnly,
  interpretation: 'Path overlap is a heuristic, not feature parity. A donor-only path is a review candidate, not proof a feature is missing; differently named implementations and runtime behavior require separate analysis.'
};
fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2) + '\n');
console.log(`Compared inventories: ${exact.length} matching paths, ${donorOnly.length} donor-only, ${apolloOnly.length} Apollo-only.`);
