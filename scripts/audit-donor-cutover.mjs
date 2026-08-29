#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CURRENT_IDENTITY_FORBIDDEN = new RegExp(`${["chat", "tag"].join("[ _-]?")}|${"chat" + "tag"}`, "i");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".json", ".mjs", ".ts", ".tsx"]);

export function validateCutoverStructure({ root, guard, parity, wiring, rehearsal }) {
  const errors = [];
  if (guard?.schemaVersion !== 1) errors.push("production donor guard must use schemaVersion 1");
  if (parity?.schemaVersion !== 1 || parity?.appCodeParity !== "complete") errors.push("app-code parity manifest must remain complete and versioned");
  if (rehearsal?.schemaVersion !== 1 || rehearsal?.mode !== "dry-run") errors.push("cutover rehearsal must remain a schemaVersion 1 dry-run");
  if (rehearsal?.policy?.donorMutationAllowed !== false || rehearsal?.policy?.donorRetirementAllowed !== false) errors.push("cutover rehearsal may not mutate or retire donors");
  const donors = new Set((guard?.donors ?? []).map((item) => item.product));
  const owners = new Set(["spmt", "spacemountain", ...(guard?.firstPartyApps ?? [])]);
  for (const capability of wiring?.capabilities ?? []) {
    if (typeof capability.ownerAppId === "string") owners.add(capability.ownerAppId);
    if (typeof capability.dataOwner === "string") owners.add(capability.dataOwner);
    if (typeof capability.executionOwner === "string") owners.add(capability.executionOwner);
  }
  const requiredProofs = new Set(rehearsal?.policy?.requiredProofs ?? []);
  const datasetIds = new Set();
  for (const dataset of rehearsal?.datasets ?? []) {
    if (!dataset.datasetId || datasetIds.has(dataset.datasetId)) errors.push(`duplicate or missing cutover dataset: ${dataset.datasetId ?? "unknown"}`);
    datasetIds.add(dataset.datasetId);
    if (!owners.has(dataset.targetOwner)) errors.push(`${dataset.datasetId} has unknown target owner ${dataset.targetOwner}`);
    for (const donor of dataset.sourceDonors ?? []) if (!donors.has(donor)) errors.push(`${dataset.datasetId} references unpinned donor ${donor}`);
    if (!new Set(["blocked", "verified"]).has(dataset.status)) errors.push(`${dataset.datasetId} has invalid status ${dataset.status}`);
    if (dataset.status === "verified") {
      for (const proof of requiredProofs) if (dataset.evidence?.[proof] === undefined) errors.push(`${dataset.datasetId} is verified without ${proof}`);
      if (dataset.evidence?.sourceCount !== dataset.evidence?.targetCount) errors.push(`${dataset.datasetId} verified counts do not match`);
      if (dataset.evidence?.sourceCanonicalSha256 !== dataset.evidence?.targetCanonicalSha256) errors.push(`${dataset.datasetId} verified checksums do not match`);
    }
  }
  for (const [family, evidence] of Object.entries(parity?.evidence ?? {})) {
    if (!Array.isArray(evidence) || evidence.length === 0) errors.push(`${family} has no parity evidence`);
    for (const relative of evidence ?? []) if (!existsSync(resolve(root, relative))) errors.push(`${family} evidence is missing: ${relative}`);
  }
  return errors;
}

export function auditChangedFiles({ root, changedFiles, knownOwners }) {
  const errors = [];
  const affectedOwners = new Set();
  for (const relative of changedFiles) {
    const normalized = relative.replaceAll("\\", "/");
    const app = normalized.match(/^apps\/([^/]+)\//)?.[1];
    if (app) {
      affectedOwners.add(app);
      if (!knownOwners.has(app)) errors.push(`changed app is not represented by a current capability owner: ${app}`);
    }
    if (!/^(?:apps|packages)\//.test(normalized) || !SOURCE_EXTENSIONS.has(extname(normalized))) continue;
    const absolute = resolve(root, normalized);
    if (!absolute.startsWith(`${resolve(root)}${sep}`) || !existsSync(absolute)) continue;
    const text = readFileSync(absolute, "utf8");
    if (CURRENT_IDENTITY_FORBIDDEN.test(text)) errors.push(`${normalized} points current code at an obsolete donor identity; use Nebula Arcade`);
  }
  return { errors, affectedOwners: [...affectedOwners].sort() };
}

export function auditRepository(root, options = {}) {
  const readJson = (relative) => JSON.parse(readFileSync(resolve(root, relative), "utf8"));
  const guard = readJson("docs/donor-audits/production-rebuild-guard.v1.json");
  const parity = readJson("docs/donor-audits/app-code-parity.v1.json");
  const wiring = readJson("config/capability-wiring.v1.json");
  const rehearsal = readJson("config/donor-cutover-rehearsal.v1.json");
  const structuralErrors = validateCutoverStructure({ root, guard, parity, wiring, rehearsal });
  const knownOwners = new Set(["spmt-service", "spacemountain", "spacemountain-web", "reference-app", ...(guard.firstPartyApps ?? []), ...(wiring.capabilities ?? []).map((item) => item.ownerAppId)]);
  const currentSourceFiles = listTracked(root, ["apps", "packages"]);
  const currentIdentity = auditChangedFiles({ root, changedFiles: currentSourceFiles, knownOwners });
  structuralErrors.push(...currentIdentity.errors);
  const changed = options.changedFiles ? auditChangedFiles({ root, changedFiles: options.changedFiles, knownOwners }) : { errors: [], affectedOwners: [] };
  structuralErrors.push(...changed.errors);
  const blockers = (rehearsal.datasets ?? []).filter((item) => item.status !== "verified").map((item) => `${item.datasetId}: ${item.reason}`);
  if (guard.knownProductionEvidence?.fly?.inventoryComplete !== true) blockers.push("live Fly machine, process-group and volume inventory is incomplete");
  if (guard.policy?.donorRetirementRequiresOwnerApproval) blockers.push("owner cutover acceptance and rollback checkpoint are not recorded");
  const ready = structuralErrors.length === 0 && blockers.length === 0 && rehearsal.cutoverReady === true;
  return {
    schemaVersion: 1,
    ready,
    mode: rehearsal.mode,
    structuralErrors,
    blockers,
    changedFiles: options.changedFiles ?? [],
    affectedOwners: changed.affectedOwners,
    frozenDonors: (guard.donors ?? []).map((item) => ({ repository: item.repository, frozenHead: item.frozenHead })),
  };
}

function listTracked(root, paths) {
  const result = spawnSync("git", ["ls-files", "--", ...paths], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git ls-files failed");
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function changedSince(root, reference) {
  if (!/^[A-Za-z0-9._/-]+$/.test(reference)) throw new Error("changed-since reference contains unsupported characters");
  const result = spawnSync("git", ["diff", "--name-only", `${reference}...HEAD`], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git diff failed");
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function parseCli(argv) {
  const options = { json: false, requireReady: false, changedSince: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") options.json = true;
    else if (value === "--require-ready") options.requireReady = true;
    else if (value === "--changed-since") options.changedSince = argv[++index];
    else throw new Error(`unknown argument ${value}`);
  }
  return options;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const options = parseCli(process.argv.slice(2));
    const changedFiles = options.changedSince ? changedSince(root, options.changedSince) : undefined;
    const report = auditRepository(root, { ...(changedFiles ? { changedFiles } : {}) });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Donor cutover rehearsal: ${report.ready ? "READY" : "BLOCKED"} (${report.mode})`);
      console.log(`Pinned donors: ${report.frozenDonors.length}; structural errors: ${report.structuralErrors.length}; blockers: ${report.blockers.length}`);
      if (report.affectedOwners.length) console.log(`Changed capability owners: ${report.affectedOwners.join(", ")}`);
      for (const error of report.structuralErrors) console.error(`ERROR ${error}`);
      for (const blocker of report.blockers) console.log(`BLOCKED ${blocker}`);
    }
    if (report.structuralErrors.length || (options.requireReady && !report.ready)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
