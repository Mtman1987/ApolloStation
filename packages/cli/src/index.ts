import { SpmtClient } from "@spmt/sdk";
export async function runSpmtCli(argv: string[], client: SpmtClient): Promise<unknown> {
  const [group, action, ...args] = argv;
  if (group === "session" && action === "show") return client.getSession();
  if (group === "workspace" && action === "get") return client.getWorkspaceProfile(required(args[0], "tenantId"));
  if (group === "workspace" && action === "update") return client.updateWorkspaceProfile(required(args[0], "tenantId"), number(args[1], "expectedRevision"), jsonObject(args[2], "patch"));
  if (group === "xp" && action === "balance") return client.getXpBalance(required(args[0], "tenantId"), required(args[1], "userId"));
  if (group === "xp" && action === "award") return client.awardXp(required(args[0], "tenantId"), required(args[1], "userId"), number(args[2], "delta"), required(args[3], "reason"), required(args[4], "idempotencyKey"));
  if (group === "event" && action === "publish") return client.publishEvent(required(args[0], "tenantId"), required(args[1], "type"), jsonObject(args[3], "payload"), required(args[2], "idempotencyKey"));
  if (group === "apps" && action === "list") return client.listApps();
  if (group === "apps" && action === "get") return client.getApp(required(args[0], "appId"));
  if (group === "apps" && action === "install") return client.installApp(required(args[0], "tenantId"), required(args[1], "appId"), args[2] ? jsonStringArray(args[2], "grantedScopes") : undefined);
  if (group === "apps" && action === "disable") return client.disableApp(required(args[0], "tenantId"), required(args[1], "appId"));
  if (group === "apps" && action === "installed") return client.listInstalls(required(args[0], "tenantId"));
  if (group === "entitlements" && action === "list") return client.listEntitlements(required(args[0], "tenantId"), args[1]);
  throw new Error("Unsupported command");
}
function required(value: string | undefined, name: string) { if (!value) throw new Error(`${name} is required`); return value; }
function number(value: string | undefined, name: string) { const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer`); return parsed; }
function jsonObject(value: string | undefined, name: string) { const parsed = JSON.parse(required(value, name)) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object`); return parsed as Record<string, unknown>; }
function jsonStringArray(value: string, name: string) { const parsed = JSON.parse(value) as unknown; if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error(`${name} must be a JSON string array`); return parsed as string[]; }
