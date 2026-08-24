import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AccountRecoveryService, AccountSetupError, SqliteAccountSetupStore } from "@spmt/account-recovery-core";
import { AuthorityService } from "@spmt/authority-core";
import { SqliteAuthorityStore } from "@spmt/authority-sqlite";
import { AuthService } from "@spmt/auth-core";
import { ControlService } from "@spmt/control-core";
import { OutboxDispatcher } from "@spmt/outbox-core";
import { PlatformDataError, PlatformDataService, type OAuthClientV1 } from "@spmt/platform-data-core";
import { SqlitePlatformDataStore } from "@spmt/platform-data-sqlite";
import { PlatformOperations, type CoderRuntimeV1 } from "@spmt/platform-ops";
import { PlatformApiAdapter } from "@spmt/api-adapter";
import { HealthRegistry } from "@spmt/runtime";

const USER_SCOPES = ["identity:read","identity:write","workspace:read","workspace:write","xp:read","apps:read","apps:install","entitlements:read","events:read","commlink:read","commlink:write","notifications:read","notifications:write","webhooks:read","webhooks:write","assistants:read","assistants:invoke","stellar:context:read","stellar:context:write","stellar:capabilities:read"];
const SANDBOX_OWNER_SCOPES = ["apps:register","operations:logs:read","operations:coder:read","operations:coder:invoke"];

export interface SpmtServiceOptions {
  databasePath: string;
  webhookKey: Uint8Array;
  port?: number;
  host?: string;
  buildSha?: string;
  fetchImpl?: typeof fetch;
  publicBaseUrl?: string;
  twitchClientId?: string;
  twitchClientSecret?: string;
  discordBotToken?: string;
  sendDiscordDm?: (discordUserId: string, message: { title: string; description: string; url: string }) => Promise<void>;
  runtimeMode?: "production" | "sandbox";
  sandboxFixtures?: boolean;
  sandboxOwnerUsername?: string;
  coderRuntime?: CoderRuntimeV1;
}

export function createSpmtService(options: SpmtServiceOptions) {
  const runtimeMode = options.runtimeMode ?? "production";
  if (runtimeMode === "sandbox" && (options.twitchClientId || options.twitchClientSecret || options.discordBotToken || options.sendDiscordDm)) {
    throw new Error("Sandbox mode rejects Twitch and Discord provider integrations");
  }
  if (options.sandboxFixtures && runtimeMode !== "sandbox") throw new Error("Sandbox fixtures require sandbox runtime mode");
  const store = new SqliteAuthorityStore(options.databasePath);
  const platformStore = new SqlitePlatformDataStore(options.databasePath);
  const setupStore = new SqliteAccountSetupStore(options.databasePath);
  const authority = new AuthorityService({ store });
  const auth = new AuthService({ store });
  const control = new ControlService({ store });
  const data = new PlatformDataService({ store: platformStore, auth, webhookKey: options.webhookKey });
  const accounts = new AccountRecoveryService({ authority, authorityStore: store, control, platformStore, setupStore });
  const operations = new PlatformOperations(auth, authority, control, data, undefined, options.coderRuntime);
  const api = new PlatformApiAdapter(operations);
  const health = new HealthRegistry();
  health.setDependency("authority-storage", "ready", `sqlite:${store.journalMode()}`);
  health.setDependency("outbound-integrations", runtimeMode === "sandbox" ? "degraded" : "ready", runtimeMode === "sandbox" ? "disabled by sandbox contract" : "enabled");
  const fetchImpl = options.fetchImpl ?? fetch;
  const publicBaseUrl = (options.publicBaseUrl ?? "https://spmt.live").replace(/\/$/, "");
  const sendDiscordDm = options.sendDiscordDm ?? (options.discordBotToken ? createDiscordDmSender(options.discordBotToken, fetchImpl) : undefined);

  if (options.sandboxFixtures) seedSandboxFixtures(control, data, publicBaseUrl);

  const outbox = new OutboxDispatcher({
    authority,
    workerId: "spmt-webhooks",
    deliver: async (record) => data.deliverWebhookEvent(
      { eventId: record.eventId, tenantId: record.tenantId, type: record.topic, payload: record.payload },
      async (url, body, headers) => {
        if (runtimeMode === "sandbox") throw new Error("Sandbox mode blocks outbound webhook delivery");
        const response = await fetchImpl(url, { method: "POST", headers, body });
        if (!response.ok) throw new Error(`Webhook delivery failed with ${response.status}`);
      },
    ),
  });

  const server = createServer(async (request, response) => {
    try {
      const path = request.url ?? "/";
      const url = new URL(`http://spmt.local${path}`);

      if (request.method === "GET" && url.pathname === "/health/live") return json(response, 200, { live: true, service: "spmt", runtimeMode, outboundIntegrations: runtimeMode === "sandbox" ? "disabled" : "enabled", buildSha: options.buildSha ?? "dev" });
      if (request.method === "GET" && url.pathname === "/health/ready") {
        const probe = store.probe();
        if (!probe.ready) health.setDependency("authority-storage", "unavailable", "authority epoch unavailable");
        else health.setDependency("authority-storage", "ready", `sqlite:${probe.journalMode}`);
        const state = health.snapshot();
        const ready = probe.ready && state.state !== "unavailable";
        return json(response, ready ? 200 : 503, { ...state, storage: probe, runtimeMode, outboundIntegrations: runtimeMode === "sandbox" ? "disabled" : "enabled", sandboxFixtures: Boolean(options.sandboxFixtures), buildSha: options.buildSha ?? "dev" });
      }

      if (request.method === "GET" && url.pathname === "/v1/auth/setup-options") {
        return json(response, 200, {
          options: [
            {
              id: "spacemountain-invite",
              primary: true,
              title: "First time here? Start with SpaceMountain",
              description: "Open the SpaceMountain welcome channel and use the invite. Your Discord click is verified first, then Twitch is linked, then you set your SPMT password.",
              actionLabel: "Open SpaceMountain welcome",
            },
            {
              id: "discord-dm-reset",
              primary: false,
              title: "Already an SPMT member?",
              description: "Send a one-time password reset link to the Discord account already linked to your SPMT identity.",
              actionLabel: "Send password reset to my Discord DM",
            },
          ],
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/accounts/provision") {
        const body = await readBody(request);
        const tenantId = str(body.tenantId, "tenantId");
        const token = accessToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        const principal = auth.authorize(token, "identity:provision", tenantId);
        const result = accounts.provisionAccount({
          tenantId,
          sourceAppId: principal.actorId,
          ...(typeof body.username === "string" ? { username: body.username } : {}),
          ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
          ...(isIdentity(body.discord) ? { discord: body.discord } : {}),
          ...(isIdentity(body.twitch) ? { twitch: body.twitch } : {}),
        });
        return json(response, result.createdUser || result.createdTenant ? 201 : 200, result);
      }

      if (request.method === "POST" && url.pathname === "/v1/onboarding/discord-invite") {
        const body = await readBody(request);
        const tenantId = str(body.tenantId, "tenantId");
        const token = accessToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        const principal = auth.authorize(token, "identity:onboard", tenantId);
        if (!isIdentity(body.discord)) return json(response, 400, { error: "discord_identity_required" });
        const result = accounts.createDiscordInvite({
          tenantId,
          sourceAppId: principal.actorId,
          discord: body.discord,
          ...(typeof body.username === "string" ? { username: body.username } : {}),
          ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
        });
        const displayName = result.account.profile.displayName;
        const setupUrl = `${publicBaseUrl}/v1/onboarding/twitch/start?ticket=${encodeURIComponent(result.ticket)}`;
        return json(response, 201, {
          account: result.account,
          welcome: {
            title: `Welcome to SpaceMountain, ${displayName}`,
            description: "Click below to link your Twitch account to this verified Discord identity. After Twitch verifies you, SpaceMountain will bring you back to finish setting your SPMT password.",
            actionLabel: "Link Twitch & finish setup",
            setupUrl,
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/onboarding/twitch/start") {
        const ticket = url.searchParams.get("ticket") ?? "";
        if (!options.twitchClientId || !options.twitchClientSecret) return json(response, 503, { error: "twitch_setup_unavailable" });
        const started = accounts.beginTwitchVerification(ticket);
        const redirectUri = `${publicBaseUrl}/v1/onboarding/twitch/callback`;
        const twitchUrl = new URL("https://id.twitch.tv/oauth2/authorize");
        twitchUrl.searchParams.set("client_id", options.twitchClientId);
        twitchUrl.searchParams.set("redirect_uri", redirectUri);
        twitchUrl.searchParams.set("response_type", "code");
        twitchUrl.searchParams.set("scope", "user:read:email");
        twitchUrl.searchParams.set("state", started.state);
        response.writeHead(302, {
          location: twitchUrl.toString(),
          "cache-control": "no-store",
          "set-cookie": setupCookie("spmt_setup_ticket", ticket),
        });
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/v1/onboarding/twitch/callback") {
        const ticket = cookie(request, "spmt_setup_ticket");
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        if (!ticket || !state || !code || !options.twitchClientId || !options.twitchClientSecret) return redirectSetupError(response, publicBaseUrl, "That setup link expired. Start again from SpaceMountain.");
        const redirectUri = `${publicBaseUrl}/v1/onboarding/twitch/callback`;
        const tokenResponse = await fetchImpl("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: options.twitchClientId, client_secret: options.twitchClientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
        });
        const tokenPayload = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
        if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") return redirectSetupError(response, publicBaseUrl, "Twitch could not verify your account. Try again.");
        const userResponse = await fetchImpl("https://api.twitch.tv/helix/users", { headers: { "Client-Id": options.twitchClientId, Authorization: `Bearer ${tokenPayload.access_token}` } });
        const userPayload = await userResponse.json().catch(() => ({})) as { data?: Array<{ id?: string; login?: string }> };
        const twitch = userPayload.data?.[0];
        if (!userResponse.ok || !twitch?.id) return redirectSetupError(response, publicBaseUrl, "Twitch identity verification failed. Try again.");
        accounts.completeTwitchVerification(ticket, state, { id: twitch.id, ...(twitch.login ? { username: twitch.login } : {}) });
        response.writeHead(302, { location: `${publicBaseUrl}/first-time-setup?verified=1`, "cache-control": "no-store", "set-cookie": setupCookie("spmt_setup_ticket", ticket) });
        return response.end();
      }

      if (request.method === "POST" && url.pathname === "/v1/onboarding/password") {
        const body = await readBody(request);
        const ticket = cookie(request, "spmt_setup_ticket") ?? (typeof body.ticket === "string" ? body.ticket : undefined);
        if (!ticket) return json(response, 400, { error: "setup_ticket_required" });
        const result = accounts.completeFirstTimePassword(ticket, str(body.password, "password"));
        return json(response, 200, result, { "set-cookie": clearCookie("spmt_setup_ticket") });
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/dm-reset") {
        const body = await readBody(request);
        const identifier = str(body.username, "username");
        const reset = accounts.createDmPasswordReset(identifier);
        if (reset && sendDiscordDm) {
          const openUrl = `${publicBaseUrl}/v1/auth/dm-reset/open?token=${encodeURIComponent(reset.ticket)}`;
          await sendDiscordDm(reset.discordUserId, { title: "SPMT • Password setup", description: "Use this one-time link to set a new SPMT password. If you did not request it, ignore this message.", url: openUrl });
        }
        return json(response, 202, { ok: true, message: "If that SPMT account has a linked Discord identity, a one-time password setup link has been sent." });
      }

      if (request.method === "GET" && url.pathname === "/v1/auth/dm-reset/open") {
        const ticket = url.searchParams.get("token") ?? "";
        accounts.openDmPasswordReset(ticket);
        response.writeHead(302, { location: `${publicBaseUrl}/first-time-setup?mode=reset`, "cache-control": "no-store", "set-cookie": setupCookie("spmt_reset_ticket", ticket) });
        return response.end();
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/dm-reset/password") {
        const body = await readBody(request);
        const ticket = cookie(request, "spmt_reset_ticket") ?? (typeof body.ticket === "string" ? body.ticket : undefined);
        if (!ticket) return json(response, 400, { error: "reset_ticket_required" });
        const result = accounts.completeDmPasswordReset(ticket, str(body.password, "password"));
        return json(response, 200, result, { "set-cookie": clearCookie("spmt_reset_ticket") });
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/register") {
        const body = await readBody(request);
        const username = str(body.username, "username");
        const password = str(body.password, "password");
        const displayName = str(body.displayName ?? body.username, "displayName");
        const userId = `usr_${randomBytes(12).toString("hex")}`;
        const tenantId = `tenant_${userId}`;
        authority.ensureUser(userId);
        control.registerTenant({ tenantId, ownerUserId: userId, displayName });
        authority.getOrCreateWorkspace(tenantId);
        const profile = data.registerUser({ userId, username, displayName, password, tenantIds: [tenantId] });
        if (options.sandboxFixtures) seedSandboxOperationsLog(data, tenantId);
        return json(response, 201, { profile, tenantId });
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/login") {
        const body = await readBody(request);
        const username = str(body.username, "username");
        const inspection = accounts.inspectSignIn(username);
        if (inspection.state === "setup-required") {
          return json(response, 409, { error: "setup_required", flow: "first-time-setup", next: "spacemountain-invite", optionsUrl: "/v1/auth/setup-options", tenantId: inspection.tenantId });
        }
        try {
          const ownerUsername = options.sandboxOwnerUsername?.trim().toLowerCase();
          const isSandboxOwner = runtimeMode === "sandbox" && Boolean(ownerUsername) && username.trim().toLowerCase() === ownerUsername;
          const result = data.login(username, str(body.password, "password"), isSandboxOwner ? [...USER_SCOPES, ...SANDBOX_OWNER_SCOPES] : USER_SCOPES);
          return json(response, 200, result, { "set-cookie": sessionCookie(result.tokens.accessToken) });
        } catch { return json(response, 401, { error: "invalid_credentials" }); }
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
        return json(response, 200, { ok: true }, { "set-cookie": clearCookie("spmt_token") });
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/refresh") {
        const body = await readBody(request);
        try {
          const result = auth.rotateHumanRefresh(str(body.refreshToken, "refreshToken"));
          return json(response, 200, result, { "set-cookie": sessionCookie(result.accessToken) });
        } catch { return json(response, 401, { error: "invalid_refresh" }); }
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/service-token") {
        const body = await readBody(request);
        if (typeof body.serviceId !== "string" || typeof body.credential !== "string") return json(response, 400, { error: "invalid_request" });
        try { return json(response, 200, auth.issueServiceAccess(body.serviceId, body.credential)); }
        catch { return json(response, 401, { error: "invalid_credentials" }); }
      }

      if (request.method === "GET" && url.pathname === "/v1/oauth/authorize") {
        const session = accessToken(request);
        if (!session) return json(response, 401, { error: "login_required" });
        const clientId = url.searchParams.get("client_id") ?? "";
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? "";
        if (!state || state.length > 500) return json(response, 400, { error: "invalid_state" });
        const challenge = url.searchParams.get("code_challenge") ?? undefined;
        const method = url.searchParams.get("code_challenge_method");
        if (challenge && method !== "S256") return json(response, 400, { error: "unsupported_code_challenge_method" });
        const scopes = (url.searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean);
        try {
          const grant = data.authorize({ sessionAccessToken: session, clientId, redirectUri, ...(scopes.length ? { scopes } : {}), ...(challenge ? { codeChallenge: challenge } : {}) });
          const callback = new URL(redirectUri);
          callback.searchParams.set("code", grant.code);
          callback.searchParams.set("state", state);
          response.writeHead(302, { location: callback.toString(), "cache-control": "no-store" });
          return response.end();
        } catch (error) { return json(response, 400, { error: "invalid_request", message: error instanceof Error ? error.message : "OAuth authorization failed" }); }
      }

      if (request.method === "POST" && url.pathname === "/v1/oauth/token") {
        const body = await readBody(request);
        if (body.grant_type !== "authorization_code") return json(response, 400, { error: "unsupported_grant_type" });
        try {
          const result = data.exchangeCode({ code: str(body.code, "code"), clientId: str(body.client_id, "client_id"), redirectUri: str(body.redirect_uri, "redirect_uri"), ...(typeof body.client_secret === "string" ? { clientSecret: body.client_secret } : {}), ...(typeof body.code_verifier === "string" ? { codeVerifier: body.code_verifier } : {}) });
          return json(response, 200, { access_token: result.accessToken, refresh_token: result.refreshToken, expires_at: result.accessExpiresAt, user: result.user });
        } catch (error) { return json(response, 400, { error: "invalid_grant", message: error instanceof Error ? error.message : "Token exchange failed" }); }
      }

      if (request.method === "GET" && url.pathname === "/v1/oauth/userinfo") {
        const token = accessToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        try { return json(response, 200, data.userinfo(token)); }
        catch { return json(response, 401, { error: "unauthorized" }); }
      }

      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value]));
      if (!headers.authorization) {
        const cookieToken = cookie(request, "spmt_token");
        if (cookieToken) headers.authorization = `Bearer ${cookieToken}`;
      }
      const result = api.handle({ method: request.method ?? "GET", path, headers, ...(body === undefined ? {} : { body }) });
      return json(response, result.status, result.body ?? null);
    } catch (error) {
      const invalid = error instanceof SyntaxError || error instanceof PlatformDataError || error instanceof AccountSetupError || (error instanceof Error && /body too large|JSON object required|required/.test(error.message));
      return json(response, invalid ? 400 : 500, { error: invalid ? "invalid_request" : "internal", message: error instanceof Error ? error.message : "unknown" });
    }
  });

  return {
    store, platformStore, setupStore, authority, auth, control, data, accounts, operations, outbox, server,
    registerOAuthClient(input: Parameters<PlatformDataService["registerOAuthClient"]>[0]): ReturnType<PlatformDataService["registerOAuthClient"]> { return data.registerOAuthClient(input); },
    runOutboxOnce() { return outbox.runOnce(); },
    listen() { return new Promise<void>((done, reject) => { server.once("error", reject); server.listen(options.port ?? 3000, options.host ?? "0.0.0.0", () => { server.off("error", reject); done(); }); }); },
    close() { return new Promise<void>((done, reject) => server.close((error) => { setupStore.close(); platformStore.close(); store.close(); error ? reject(error) : done(); })); },
  };
}

export function validateSandboxServiceEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.SPMT_RUNTIME_MODE !== "sandbox") throw new Error("SPMT_RUNTIME_MODE=sandbox is required");
  if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("SPMT_OUTBOUND_MODE=disabled is required");
  if (!environment.SPMT_SANDBOX_ID || !/^[a-z0-9-]{3,80}$/.test(environment.SPMT_SANDBOX_ID)) throw new Error("SPMT_SANDBOX_ID must be a lowercase sandbox namespace");
  const forbidden = ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_BOT_OAUTH_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PROJECT_ID", "NEXT_PUBLIC_YOUTUBE_INNERTUBE_API_KEY", "YOUTUBE_API_KEY", "FLY_API_TOKEN", "SPRITES_TOKEN"].filter((name) => Boolean(environment[name]));
  if (forbidden.length) throw new Error(`Sandbox SPMT rejects provider or infrastructure credentials: ${forbidden.join(", ")}`);
  const databasePath = environment.DATABASE_PATH;
  if (!databasePath || !isAbsolute(databasePath) || !basename(databasePath).toLowerCase().includes("sandbox")) throw new Error("DATABASE_PATH must be an absolute sandbox-named SQLite path");
  const publicBaseUrl = requireSandboxPublicUrl(environment.SPMT_PUBLIC_URL);
  const host = environment.SPMT_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Sandbox SPMT must bind only to loopback through SPMT_HOST");
  if (!["0", "1"].includes(environment.SPMT_SANDBOX_FIXTURES ?? "")) throw new Error("SPMT_SANDBOX_FIXTURES must be 0 or 1");
  const sandboxOwnerUsername = environment.SPMT_SANDBOX_OWNER_USERNAME?.trim().toLowerCase();
  if (sandboxOwnerUsername && !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(sandboxOwnerUsername)) throw new Error("SPMT_SANDBOX_OWNER_USERNAME is invalid");
  return { databasePath, publicBaseUrl, host, ...(sandboxOwnerUsername ? { sandboxOwnerUsername } : {}) };
}

function seedSandboxFixtures(control: ControlService, data: PlatformDataService, publicBaseUrl: string) {
  registerFixture(control, {
    appId: "spacemountain",
    name: "SpaceMountain",
    description: "The Green command bridge for SPMT identity, Shipyard, Commlink, workspace, and Stellar Core surfaces.",
    version: "0.1.0-sandbox",
    launchUrl: new URL("/", publicBaseUrl).toString(),
    allowedScopes: ["workspace:read", "xp:read", "apps:read", "apps:install", "entitlements:read", "events:read", "commlink:read", "notifications:read", "assistants:read", "assistants:invoke", "stellar:context:read", "stellar:capabilities:read", "operations:logs:read", "operations:coder:read", "operations:coder:invoke"],
    surfaces: ["shell", "standalone"],
    status: "active",
  });
  registerFixture(control, {
    appId: "orbit-beacon",
    name: "Orbit Beacon",
    description: "An inert registry fixture proving that an approved app appears and launches without a hardcoded SpaceMountain tile.",
    version: "1.0.0-sandbox",
    launchUrl: new URL("/sandbox/beacon", publicBaseUrl).toString(),
    allowedScopes: [],
    surfaces: ["standalone"],
    status: "active",
  });
  const capability = data.listStellarCapabilities().find((item) => item.id === "sandbox.registry.inspect");
  if (!capability) data.upsertStellarCapability({ id: "sandbox.registry.inspect", sourceAppId: "spmt", title: "Inspect the sandbox app registry", description: "Read the isolated Green registry and verify dynamic SpaceMountain discovery without provider access.", requiredScopes: ["apps:read"], availability: "available" });
  const communityAssistant = data.listStellarCapabilities().find((item) => item.id === "spmt.community-assistant");
  if (!communityAssistant) data.upsertStellarCapability({ id: "spmt.community-assistant", sourceAppId: "spmt", title: "Stella Community Assistant", description: "Invoke the app-neutral SPMT Community Assistant through the public developer contracts.", requiredScopes: ["assistants:invoke"], availability: "unavailable", unavailableReason: "The isolated Green sandbox has no Stellar Core inference provider or worker connected." });
  const operationsLogs = data.listStellarCapabilities().find((item) => item.id === "spmt.operations.logs");
  if (!operationsLogs) data.upsertStellarCapability({ id: "spmt.operations.logs", sourceAppId: "spmt", title: "Consolidated operations evidence", description: "Read redacted, tenant-scoped app and Rotator operational records through the public developer contracts.", requiredScopes: ["operations:logs:read"], availability: "available" });
  const operationsCoder = data.listStellarCapabilities().find((item) => item.id === "spmt.operations.coder");
  if (!operationsCoder) data.upsertStellarCapability({ id: "spmt.operations.coder", sourceAppId: "spmt", title: "Rotator AI coder", description: "Prepare a bounded coder job from selected operational evidence without granting repository or deployment authority.", requiredScopes: ["operations:logs:read", "operations:coder:invoke"], availability: "unavailable", unavailableReason: "The isolated Green sandbox has no Rotator coder worker connected." });
}

function seedSandboxOperationsLog(data: PlatformDataService, tenantId: string) {
  data.createOperationsLog({ tenantId, sourceAppId: "spacemountain", reporterId: "spmt-sandbox", level: "info", kind: "sandbox.fixture", summary: "Synthetic sandbox fixture: the consolidated operations-log path is available; no Fly runtime or Rotator worker is connected.", labels: ["sandbox", "synthetic"], idempotencyKey: "sandbox-operations-fixture-v1" });
}

function registerFixture(control: ControlService, manifest: Parameters<ControlService["registerApp"]>[0]) {
  let existing: ReturnType<ControlService["getApp"]> | undefined;
  try { existing = control.getApp(manifest.appId); } catch { existing = undefined; }
  if (existing && existing.name === manifest.name && existing.description === manifest.description && existing.version === manifest.version && existing.launchUrl === new URL(manifest.launchUrl).toString() && existing.status === manifest.status && JSON.stringify(existing.allowedScopes) === JSON.stringify([...manifest.allowedScopes].sort()) && JSON.stringify(existing.surfaces) === JSON.stringify(manifest.surfaces)) return existing;
  return control.registerApp(manifest);
}

function requireSandboxPublicUrl(value: string | undefined) {
  if (!value) throw new Error("SPMT_PUBLIC_URL is required in sandbox mode");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("SPMT_PUBLIC_URL must be an absolute URL"); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || (!local && !url.hostname.endsWith(".sprites.app"))) throw new Error("SPMT_PUBLIC_URL must be the private Sprite HTTPS URL or localhost");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_PUBLIC_URL must be a credential-free origin");
  return url.origin;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += buffer.byteLength; if (total > 1024 * 1024) throw new Error("request body too large"); chunks.push(buffer); }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}
function str(value: unknown, name: string) { if (typeof value !== "string" || !value) throw new Error(`${name} is required`); return value; }
function accessToken(request: IncomingMessage) { const authorization = request.headers.authorization; if (authorization?.startsWith("Bearer ")) return authorization.slice(7); return cookie(request, "spmt_token"); }
function cookie(request: IncomingMessage, name: string) { const source = request.headers.cookie ?? ""; for (const item of source.split(";")) { const [index, ...rest] = item.trim().split("="); if (index === name) return decodeURIComponent(rest.join("=")); } return undefined; }
function sessionCookie(token: string) { return `spmt_token=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function setupCookie(name: string, token: string) { return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`; }
function clearCookie(name: string) { return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
function isIdentity(value: unknown): value is { id: string; username?: string } { return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"); }
function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) { const encoded = JSON.stringify(body); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(encoded), ...headers }); response.end(encoded); }
function redirectSetupError(response: ServerResponse, base: string, message: string) { const target = new URL("/first-time-setup", base); target.searchParams.set("setupError", message); response.writeHead(302, { location: target.toString(), "cache-control": "no-store" }); response.end(); }
function decodeKey(value: string) { const key = Buffer.from(value, "base64url"); if (key.byteLength !== 32) throw new Error("SPMT_WEBHOOK_KEY must be base64url for exactly 32 bytes"); return key; }
function createDiscordDmSender(botToken: string, fetchImpl: typeof fetch) {
  return async (discordUserId: string, message: { title: string; description: string; url: string }) => {
    const headers = { Authorization: `Bot ${botToken}`, "content-type": "application/json" };
    const channelResponse = await fetchImpl("https://discord.com/api/v10/users/@me/channels", { method: "POST", headers, body: JSON.stringify({ recipient_id: discordUserId }) });
    if (!channelResponse.ok) throw new Error(`Discord DM channel failed with ${channelResponse.status}`);
    const channel = await channelResponse.json() as { id?: string };
    if (!channel.id) throw new Error("Discord DM channel had no id");
    const sent = await fetchImpl(`https://discord.com/api/v10/channels/${encodeURIComponent(channel.id)}/messages`, { method: "POST", headers, body: JSON.stringify({ embeds: [{ title: message.title, description: `${message.description}\n\n[Continue securely](${message.url})`, color: 0x7c3aed }], allowed_mentions: { parse: [] } }) });
    if (!sent.ok) throw new Error(`Discord DM send failed with ${sent.status}`);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const databasePath = process.env.DATABASE_PATH;
  const key = process.env.SPMT_WEBHOOK_KEY;
  if (!databasePath) throw new Error("DATABASE_PATH is required; SPMT will not fall back to a local production database");
  if (!key) throw new Error("SPMT_WEBHOOK_KEY is required");
  const buildSha = process.env.BUILD_SHA;
  const runtimeMode = process.env.SPMT_RUNTIME_MODE === "sandbox" ? "sandbox" : "production";
  const checked = runtimeMode === "sandbox" ? validateSandboxServiceEnvironment(process.env) : undefined;
  const publicBaseUrl = checked?.publicBaseUrl ?? process.env.SPMT_PUBLIC_URL ?? "https://spmt.live";
  const twitchClientId = process.env.TWITCH_CLIENT_ID;
  const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
  const discordBotToken = process.env.DISCORD_BOT_TOKEN;
  const service = createSpmtService({
    databasePath,
    webhookKey: decodeKey(key),
    port: Number(process.env.PORT ?? 3000),
    publicBaseUrl,
    runtimeMode,
    sandboxFixtures: runtimeMode === "sandbox" && process.env.SPMT_SANDBOX_FIXTURES === "1",
    ...(checked?.sandboxOwnerUsername ? { sandboxOwnerUsername: checked.sandboxOwnerUsername } : {}),
    ...(checked?.host ? { host: checked.host } : {}),
    ...(buildSha ? { buildSha } : {}),
    ...(twitchClientId ? { twitchClientId } : {}),
    ...(twitchClientSecret ? { twitchClientSecret } : {}),
    ...(discordBotToken ? { discordBotToken } : {}),
  });
  await service.listen();
}
