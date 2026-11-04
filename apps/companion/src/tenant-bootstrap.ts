export const COMPANION_BOOTSTRAP_PROTOCOL = "spmt-companion:";
export const DEFAULT_SPMT_ORIGIN = "https://spmt.live";
export const DEFAULT_COMPANION_BOOTSTRAP_EXCHANGE_URL = `${DEFAULT_SPMT_ORIGIN}/api/companion/bootstrap/exchange`;

export interface CompanionTenantBootstrapCodeV1 { code: string; }
export interface CompanionTenantBootstrapResultV1 {
  sessionToken: string;
  pairingToken: string;
  device: { id: string; [key: string]: unknown };
  user: { id: string; [key: string]: unknown };
  [key: string]: unknown;
}

export function parseCompanionTenantBootstrapUrl(value: unknown): CompanionTenantBootstrapCodeV1 | undefined {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== COMPANION_BOOTSTRAP_PROTOCOL || url.hostname !== "bootstrap" || url.username || url.password) return undefined;
    const code = String(url.searchParams.get("code") ?? "").trim();
    if (!code || code.length > 512 || !/^[A-Za-z0-9._~+/=-]+$/.test(code)) return undefined;
    return { code };
  } catch {
    return undefined;
  }
}

export function findCompanionTenantBootstrapUrl(argv: readonly unknown[] = []): string {
  for (const value of argv) {
    const text = String(value ?? "");
    if (parseCompanionTenantBootstrapUrl(text)) return text;
  }
  return "";
}

export async function exchangeCompanionTenantBootstrap(
  fetcher: typeof fetch,
  code: string,
  endpoint = DEFAULT_COMPANION_BOOTSTRAP_EXCHANGE_URL,
): Promise<CompanionTenantBootstrapResultV1> {
  const normalizedCode = String(code ?? "").trim();
  if (!normalizedCode || normalizedCode.length > 512 || !/^[A-Za-z0-9._~+/=-]+$/.test(normalizedCode)) throw new Error("Companion tenant link code is invalid");
  const target = new URL(endpoint);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("Companion tenant link endpoint must use credential-free HTTPS");
  const response = await fetcher(target.toString(), {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ code: normalizedCode }),
  });
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const message = record(payload)?.error;
    throw new Error(typeof message === "string" && message.trim() ? message.slice(0, 400) : `Companion tenant link failed (${response.status})`);
  }
  const input = record(payload);
  const device = record(input.device);
  const user = record(input.user);
  if (typeof input.sessionToken !== "string" || !input.sessionToken || typeof input.pairingToken !== "string" || !input.pairingToken || typeof device.id !== "string" || !device.id || typeof user.id !== "string" || !user.id) {
    throw new Error("Companion tenant link returned an incomplete response");
  }
  return {
    ...input,
    sessionToken: input.sessionToken,
    pairingToken: input.pairingToken,
    device: { ...device, id: device.id },
    user: { ...user, id: user.id },
  } as CompanionTenantBootstrapResultV1;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
