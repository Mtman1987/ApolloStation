#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CURRENT_IDENTITY_FORBIDDEN = new RegExp(`${["chat", "tag"].join("[ _-]?")}|${"chat" + "tag"}`, "i");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const SHA = /^[0-9a-f]{40}$/;

export function validateLiveSliceStructure({ root, slices, parity, wiring }) {
  const errors = [];
  if (slices?.schemaVersion !== 1) errors.push("live-source slices must use schemaVersion 1");
  if (slices?.comparisonPolicy?.sourceOfComparison !== "remote-main-and-running-live-slice") errors.push("comparisons must use remote main and the running live slice");
  if (slices?.comparisonPolicy?.retainLocalMirrors !== false) errors.push("live-source slices may not require retained local mirrors");
  if (slices?.comparisonPolicy?.mutateLiveFlyApps !== false) errors.push("live-source audit may not mutate Fly apps");
  if (parity?.schemaVersion !== 1 || parity?.appCodeParity !== "complete") errors.push("app-code parity manifest must remain complete and versioned");
  if (slices?.productionCutover?.ready !== false || slices?.productionCutover?.liveMutationAllowed !== false || slices?.productionCutover?.liveRetirementAllowed !== false) errors.push("live cutover must remain blocked, non-mutating, and non-retiring until production proof is complete");
  if (!Array.isArray(slices?.productionCutover?.blockers) || !slices.productionCutover.blockers.length) errors.push("live cutover must retain high-level production blockers");
  const sourceIds = new Set();
  const repositories = new Set();
  for (const source of slices?.sources ?? []) {
    if (!source.sourceId || sourceIds.has(source.sourceId)) errors.push(`duplicate or missing live source: ${source.sourceId ?? "unknown"}`);
    sourceIds.add(source.sourceId);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository ?? "") || repositories.has(source.repository)) errors.push(`invalid or duplicate live repository: ${source.repository ?? "unknown"}`);
    repositories.add(source.repository);
    if (source.branch !== "main" || !SHA.test(source.currentMain ?? "")) errors.push(`${source.sourceId} has an invalid remote main`);
    if (source.localMirrorRetained !== false) errors.push(`${source.sourceId} still requires a local mirror`);
    if (!Array.isArray(source.lastTwoCommits) || source.lastTwoCommits.length !== 2 || source.lastTwoCommits.some((commit) => !SHA.test(commit.sha ?? "") || !String(commit.subject ?? "").trim())) errors.push(`${source.sourceId} must record exactly two valid current commits`);
    if (source.lastTwoCommits?.[0]?.sha !== source.currentMain) errors.push(`${source.sourceId} currentMain does not match its newest audited commit`);
    if (!["caught-up", "ported"].includes(source.disposition)) errors.push(`${source.sourceId} has an invalid disposition`);
    if (!Array.isArray(source.evidence) || !source.evidence.length) errors.push(`${source.sourceId} has no Apollo evidence`);
    for (const relative of source.evidence ?? []) if (!existsSync(resolve(root, relative))) errors.push(`${source.sourceId} evidence is missing: ${relative}`);
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
    if (app) { affectedOwners.add(app); if (!knownOwners.has(app)) errors.push(`changed app is not represented by a current capability owner: ${app}`); }
    if (!/^(?:apps|packages)\//.test(normalized) || !SOURCE_EXTENSIONS.has(extname(normalized))) continue;
    const absolute = resolve(root, normalized);
    if (!absolute.startsWith(`${resolve(root)}${sep}`) || !existsSync(absolute)) continue;
    const source = readFileSync(absolute, "utf8");
    const currentSource = normalized === "apps/nebula-arcade/src/game-hub.ts" ? source.replace(`normalized === "${["chat","tag"].join("")}" ? "tag" : normalized`, "normalized") : source;
    if (CURRENT_IDENTITY_FORBIDDEN.test(currentSource)) errors.push(`${normalized} points current code at an obsolete repository identity; use Nebula Arcade`);
  }
  return { errors, affectedOwners: [...affectedOwners].sort() };
}

export function auditRemoteHeads(sources) {
  const errors = [];
  for (const source of sources) {
    const url = `https://github.com/${source.repository}.git`;
    const result = spawnSync("git", ["ls-remote", url, "refs/heads/main"], { encoding: "utf8", timeout: 30_000 });
    if (result.status !== 0) { errors.push(`${source.repository} remote main could not be checked`); continue; }
    const head = result.stdout.trim().split(/\s+/)[0] ?? "";
    if (head !== source.currentMain) errors.push(`${source.repository} advanced from ${source.currentMain} to ${head || "unknown"}`);
  }
  return errors;
}

export function auditRepository(root, options = {}) {
  const readJson = (relative) => JSON.parse(readFileSync(resolve(root, relative), "utf8"));
  const slices = readJson("config/live-source-slices.v1.json");
  const parity = readJson("docs/donor-audits/app-code-parity.v1.json");
  const wiring = readJson("config/capability-wiring.v1.json");
  const structuralErrors = validateLiveSliceStructure({ root, slices, parity, wiring });
  const knownOwners = new Set(["spmt-service", "spacemountain", "spacemountain-web", "reference-app", "chat-gateway", ...(wiring.capabilities ?? []).flatMap((item) => [item.ownerAppId, item.dataOwner, item.executionOwner]).filter(Boolean)]);
  const currentIdentity = auditChangedFiles({ root, changedFiles: listTracked(root, ["apps", "packages"]), knownOwners });
  structuralErrors.push(...currentIdentity.errors);
  const changed = options.changedFiles ? auditChangedFiles({ root, changedFiles: options.changedFiles, knownOwners }) : { errors: [], affectedOwners: [] };
  structuralErrors.push(...changed.errors);
  if (options.checkRemote) structuralErrors.push(...auditRemoteHeads(slices.sources));
  const blockers = [...slices.productionCutover.blockers];
  const ready = structuralErrors.length === 0 && blockers.length === 0 && slices.productionCutover.ready === true;
  return { schemaVersion: 1, ready, mode: "dry-run", sourceMode: slices.comparisonPolicy.sourceOfComparison, structuralErrors, blockers, changedFiles: options.changedFiles ?? [], affectedOwners: changed.affectedOwners, liveSources: slices.sources.map((item) => ({ repository: item.repository, currentMain: item.currentMain, lastTwoCommits: item.lastTwoCommits.map((commit) => commit.sha) })) };
}

function listTracked(root, paths) { const result = spawnSync("git", ["ls-files", "--", ...paths], { cwd: root, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr.trim() || "git ls-files failed"); return result.stdout.split(/\r?\n/).filter(Boolean); }
function changedSince(root, reference) { if (!/^[A-Za-z0-9._/-]+$/.test(reference)) throw new Error("changed-since reference contains unsupported characters"); const result = spawnSync("git", ["diff", "--name-only", `${reference}...HEAD`], { cwd: root, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr.trim() || "git diff failed"); return result.stdout.split(/\r?\n/).filter(Boolean); }
function parseCli(argv) { const options = { json: false, requireReady: false, checkRemote: false, changedSince: undefined }; for (let index = 0; index < argv.length; index += 1) { const value = argv[index]; if (value === "--json") options.json = true; else if (value === "--require-ready") options.requireReady = true; else if (value === "--check-remote") options.checkRemote = true; else if (value === "--changed-since") options.changedSince = argv[++index]; else throw new Error(`unknown argument ${value}`); } return options; }

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const options = parseCli(process.argv.slice(2));
    const changedFiles = options.changedSince ? changedSince(root, options.changedSince) : undefined;
    const report = auditRepository(root, { ...(changedFiles ? { changedFiles } : {}), checkRemote: options.checkRemote });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else { console.log(`Live-slice cutover rehearsal: ${report.ready ? "READY" : "BLOCKED"} (${report.mode})`); console.log(`Live sources: ${report.liveSources.length}; structural errors: ${report.structuralErrors.length}; blockers: ${report.blockers.length}`); if (report.affectedOwners.length) console.log(`Changed capability owners: ${report.affectedOwners.join(", ")}`); for (const error of report.structuralErrors) console.error(`ERROR ${error}`); for (const blocker of report.blockers) console.log(`BLOCKED ${blocker}`); }
    if (report.structuralErrors.length || (options.requireReady && !report.ready)) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
