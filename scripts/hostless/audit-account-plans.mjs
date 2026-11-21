#!/usr/bin/env node
/**
 * Read-only Hostless account/cohort and allowance audit for Apollo's two nodes.
 * Never prints credentials or environment-variable values.
 */
const api = (process.env.HOSTLESS_API_URL || "https://api.hostless.cloud/v1").replace(/\/$/, "");
const accounts = [
  ["node1", process.env.HOSTLESS_NODE1_TOKEN],
  ["node2", process.env.HOSTLESS_NODE2_TOKEN],
];
const today = new Date();
const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

function safeIdentity(value) {
  const v = value?.data ?? value?.apiKey ?? value;
  return {
    kind: v?.kind ?? null,
    name: v?.name ?? null,
    prefix: v?.prefix ?? null,
    scopes: Array.isArray(v?.scopes) ? v.scopes : [],
    projects: Array.isArray(v?.projects) ? v.projects : [],
    expiresAt: v?.expiresAt ?? null,
    accountId: v?.accountId ?? v?.ownerId ?? v?.userId ?? v?.account?.id ?? v?.owner?.id ?? null,
    accountCreatedAt: v?.accountCreatedAt ?? v?.account?.createdAt ?? v?.owner?.createdAt ?? null,
  };
}
function collectAllowance(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const x of value) collectAllowance(x, out); return out; }
  const text = JSON.stringify(value).toLowerCase();
  if (/legacy|shared|free entitlement|free allowance|included allowance|pricing cohort|plan/.test(text)) {
    const selected = {};
    for (const [k, v] of Object.entries(value)) {
      if (/legacy|shared|free|allowance|entitlement|cohort|plan|tier|cpu|memory|storage|created|cycle|name/i.test(k)) selected[k] = v;
    }
    if (Object.keys(selected).length) out.push(selected);
  }
  for (const v of Object.values(value)) collectAllowance(v, out);
  return out;
}
async function get(token, path, label, optional = false) {
  const response = await fetch(api + path, {
    headers: { Authorization: token, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 300) }; }
  if (!response.ok) {
    if (optional) return { available: false, status: response.status, reason: data?.message ?? data?.error ?? label };
    throw new Error(label + " failed with HTTP " + response.status + ": " + String(data?.message ?? data?.error ?? "request failed").slice(0, 240));
  }
  return { available: true, data };
}
const reports = [];
for (const [node, token] of accounts) {
  if (!token) throw new Error("Missing HOSTLESS_NODE" + (node === "node1" ? "1" : "2") + "_TOKEN.");
  const identityResult = await get(token, "/api-keys/current", node + " API-key identity");
  const identity = safeIdentity(identityResult.data);
  const billing = await get(token, "/billing/breakdown?startDate=" + startDate + "&endDate=" + endDate, node + " billing breakdown", true);
  const cycles = await get(token, "/billing/cycles", node + " billing cycles", true);
  const projects = await get(token, "/projects", node + " projects", true);
  const apps = await get(token, "/apps", node + " apps", true);
  const workers = await get(token, "/workers", node + " workers", true);
  const cron = await get(token, "/cron-jobs", node + " cron jobs", true);
  const databases = await get(token, "/databases", node + " databases", true);
  const rows = (r, keys) => {
    if (!r?.available) return null;
    const v = r.data;
    if (Array.isArray(v)) return v;
    for (const k of keys) if (Array.isArray(v?.[k])) return v[k];
    if (Array.isArray(v?.data)) return v.data;
    return null;
  };
  reports.push({
    node,
    credential: identity,
    billing: {
      available: billing.available,
      dateRange: { startDate, endDate },
      appliedPolicyEvidence: billing.available ? collectAllowance(billing.data) : [],
      cycles: cycles.available ? rows(cycles, ["cycles", "items"]) : null,
      rawShapeKeys: billing.available && billing.data && typeof billing.data === "object" ? Object.keys(billing.data) : [],
    },
    inventory: {
      projects: rows(projects, ["projects", "items"])?.length ?? null,
      apps: rows(apps, ["apps", "items"])?.length ?? null,
      workers: rows(workers, ["workers", "items"])?.length ?? null,
      cronJobs: rows(cron, ["cronJobs", "jobs", "items"])?.length ?? null,
      databases: rows(databases, ["databases", "items"])?.length ?? null,
    },
    access: {
      billingRead: identity.scopes.includes("billing:read"),
      appsRead: identity.scopes.includes("apps:read"),
      workersRead: identity.scopes.includes("workers:read"),
      cronRead: identity.scopes.includes("cron-jobs:read"),
      databasesRead: identity.scopes.includes("databases:read"),
    },
  });
}
const [one, two] = reports;
const sameAccount = Boolean(one.credential.accountId && two.credential.accountId &&
  one.credential.accountId === two.credential.accountId);
const samePrefix = one.credential.prefix && two.credential.prefix &&
  one.credential.prefix === two.credential.prefix;
const result = {
  audit: "hostless-account-plan-and-efficiency",
  readOnly: true,
  generatedAt: new Date().toISOString(),
  distinctAccountsConfirmed: one.credential.accountId && two.credential.accountId ? !sameAccount : null,
  sameCredentialPrefix: Boolean(samePrefix),
  reports,
};
console.log(JSON.stringify(result, null, 2));
if (sameAccount) throw new Error("Node 1 and Node 2 Hostless API keys resolve to the same account; expected independently owned accounts.");
