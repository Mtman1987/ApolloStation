import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AccountRecoveryService, AccountSetupError, SqliteAccountSetupStore } from "@spmt/account-recovery-core";
import { AuthorityService } from "@spmt/authority-core";
import { SqliteAuthorityStore } from "@spmt/authority-sqlite";
import { AuthConflictError, AuthDeniedError, AuthService } from "@spmt/auth-core";
import { ControlService } from "@spmt/control-core";
import { CommlinkLiveChatStore } from "@spmt/commlink-core";
import { ExecutionJobService } from "@spmt/execution-core";
import { MonetizationService } from "@spmt/monetization";
import { OutboxDispatcher } from "@spmt/outbox-core";
import { PlatformDataError, PlatformDataService, type OAuthClientV1 } from "@spmt/platform-data-core";
import { SqlitePlatformDataStore } from "@spmt/platform-data-sqlite";
import { PlatformOperations, type CoderRuntimeV1, type CommunityAssistantRuntimeV1 } from "@spmt/platform-ops";
import {
  ProviderGrantBroker,
  ProviderGrantError,
  SqliteProviderCredentialAuthority,
  createFirstPartyProviderRefreshAdapters,
  type ProviderGrantIssuerV1,
  type ProviderOAuthClientsV1,
} from "@spmt/provider-grants-core";
import { PlatformApiAdapter } from "@spmt/api-adapter";
import { HealthRegistry } from "@spmt/runtime";
import { assertBillingManifestV1, assertNormalizedChatMessageV1, BILLING_PLAN_IDS, type AppCatalogRegistrationV1, type BillingManifestV1, type BillingPlanIdV1, type ChatProviderV1, type NormalizedChatMessageV1 } from "@spmt/contracts";
import { STELLAR_CHAT_CAPABILITY_ID, StellarCommunityAssistantRuntime, StellarDataPrivacyService } from "@spmt/stellar-core";

const USER_SCOPES = ["identity:read","identity:write","workspace:read","workspace:write","xp:read","apps:read","apps:install","entitlements:read","usage:read","events:read","jobs:read","jobs:write","commlink:read","commlink:write","notifications:read","notifications:write","webhooks:read","webhooks:write","assistants:read","assistants:invoke","stellar:context:read","stellar:context:write","stellar:capabilities:read","stellar:data:read","stellar:data:write"];
const SANDBOX_OWNER_SCOPES = ["apps:register","jobs:any","operations:logs:read","operations:coder:read","operations:coder:invoke","overlay:widgets:read","overlay:outputs:read","overlay:outputs:write"];

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
  sandboxApps?: AppCatalogRegistrationV1[];
  coderRuntime?: CoderRuntimeV1;
  communityAssistant?: CommunityAssistantRuntimeV1;
  billingManifest?: BillingManifestV1;
  providerGrants?: ProviderGrantIssuerV1;
  providerCredentialKey?: Uint8Array;
  providerOAuthClients?: ProviderOAuthClientsV1;
  stellarChatEnabled?: boolean;
  stellarWorkerCredential?: string;
  chatGatewayEnabled?: boolean;
  chatGatewayCredential?: string;
  streamweaverProviderRuntimeEnabled?: boolean;
  streamweaverWorkerCredential?: string;
  dshLiveRuntimeEnabled?: boolean;
  dshWorkerCredential?: string;
}

export function createSpmtService(options: SpmtServiceOptions) {
  const runtimeMode = options.runtimeMode ?? "production";
  if (runtimeMode === "sandbox" && (options.twitchClientId || options.twitchClientSecret || options.discordBotToken || options.sendDiscordDm)) {
    throw new Error("Sandbox mode rejects Twitch and Discord provider integrations");
  }
  if (runtimeMode === "sandbox" && options.providerCredentialKey) throw new Error("Sandbox mode rejects the production provider credential authority");
  if (options.sandboxFixtures && runtimeMode !== "sandbox") throw new Error("Sandbox fixtures require sandbox runtime mode");
  if (options.sandboxApps?.length && runtimeMode !== "sandbox") throw new Error("Sandbox apps require sandbox runtime mode");
  const store = new SqliteAuthorityStore(options.databasePath);
  const platformStore = new SqlitePlatformDataStore(options.databasePath);
  const setupStore = new SqliteAccountSetupStore(options.databasePath);
  const commlinkLiveChat = new CommlinkLiveChatStore(options.databasePath);
  const authority = new AuthorityService({ store });
  const auth = new AuthService({ store });
  const publicBaseUrl = (options.publicBaseUrl ?? "https://spmt.live").replace(/\/$/, "");
  const control = new ControlService({ store, outputBaseUrl: publicBaseUrl });
  const billing = new MonetizationService(options.billingManifest ?? loadBillingManifest(), store);
  const data = new PlatformDataService({ store: platformStore, auth, webhookKey: options.webhookKey });
  const fetchImpl = options.fetchImpl ?? fetch;
  const providerCredentials = options.providerCredentialKey ? new SqliteProviderCredentialAuthority(options.databasePath, options.providerCredentialKey, createFirstPartyProviderRefreshAdapters(fetchImpl), { ...(options.providerOAuthClients ? { clients: options.providerOAuthClients } : {}) }) : undefined;
  const providerGrants = options.providerGrants ?? (providerCredentials ? new ProviderGrantBroker(providerCredentials) : undefined);
  const accounts = new AccountRecoveryService({ authority, authorityStore: store, control, platformStore, setupStore });
  const executionJobs = new ExecutionJobService({
    store: platformStore,
    usage: billing,
    resolvePlan: (tenantId) => billingPlan(control.listEntitlements(tenantId)),
    onTransition: (job, previousState) => data.createOperationsLog({ tenantId: job.tenantId, sourceAppId: job.ownerAppId, reporterId: "spmt-execution", level: job.state === "failed" || job.state === "dead-letter" ? "error" : job.state === "cancelled" ? "warn" : "info", kind: `execution.${job.state}`, summary: `${job.capabilityId} ${previousState ? `${previousState} -> ` : ""}${job.state} on ${job.executionTarget}`, labels: ["execution-job", job.executionTarget, job.meteredResource], ...(job.correlationId ? { correlationId: job.correlationId } : {}), idempotencyKey: `${job.id}:${job.state}:${job.fencingEpoch}:${job.attempt}:${job.updatedAt}:${job.progress?.percent ?? "none"}` }),
  });
  if (options.stellarChatEnabled && (!options.stellarWorkerCredential || options.stellarWorkerCredential.length < 32)) throw new Error("An enabled Stellar chat runtime requires a 32+ character worker credential");
  if (options.stellarWorkerCredential) ensureStellarWorkerIdentity(auth, options.stellarWorkerCredential);
  if (options.chatGatewayEnabled && (!options.chatGatewayCredential || options.chatGatewayCredential.length < 32)) throw new Error("An enabled Chat Gateway requires a 32+ character service credential");
  if (options.chatGatewayCredential) ensureChatGatewayIdentity(auth, options.chatGatewayCredential);
  if (options.streamweaverProviderRuntimeEnabled && (!options.streamweaverWorkerCredential || options.streamweaverWorkerCredential.length < 32)) throw new Error("An enabled StreamWeaver provider runtime requires a 32+ character service credential");
  if (options.streamweaverWorkerCredential) ensureStreamWeaverIdentity(auth, options.streamweaverWorkerCredential);
  if (options.dshLiveRuntimeEnabled && (!options.dshWorkerCredential || options.dshWorkerCredential.length < 32)) throw new Error("An enabled Discord Stream Hub live runtime requires a 32+ character service credential");
  if (options.dshWorkerCredential) ensureDshIdentity(auth, options.dshWorkerCredential);
  const communityAssistant = options.communityAssistant ?? new StellarCommunityAssistantRuntime(executionJobs, { enabled: Boolean(options.stellarChatEnabled), resolveRoute: (input) => resolveStellarRoute(control, executionJobs, input.tenantId, input.routingPreference ?? "automatic") });
  const stellarPrivacy = new StellarDataPrivacyService(executionJobs, data);
  const operations = new PlatformOperations(auth, authority, control, data, communityAssistant, options.coderRuntime, executionJobs, stellarPrivacy);
  const api = new PlatformApiAdapter(operations);
  const health = new HealthRegistry();
  health.setDependency("authority-storage", "ready", `sqlite:${store.journalMode()}`);
  health.setDependency("outbound-integrations", runtimeMode === "sandbox" ? "degraded" : "ready", runtimeMode === "sandbox" ? "disabled by sandbox contract" : "enabled");
  const sendDiscordDm = options.sendDiscordDm ?? (options.discordBotToken ? createDiscordDmSender(options.discordBotToken, fetchImpl) : undefined);

  if (options.sandboxFixtures) seedSandboxFixtures(control, data, publicBaseUrl);
  if (options.sandboxApps?.length) seedSandboxApps(control, store.listTenants(), options.sandboxApps);
  let lastCommunityStatusKey = "";
  const refreshCommunityAssistantCapability = () => { const status = communityAssistant.status(), key = status.availability === "available" ? "available" : `unavailable:${status.unavailableReason}`; if (key === lastCommunityStatusKey) return; syncCommunityAssistantCapability(data, status); lastCommunityStatusKey = key; };
  refreshCommunityAssistantCapability();
  stellarPrivacy.sweep(store.listTenants().map((tenant) => tenant.id));
  const stellarCapabilityTimer = setInterval(refreshCommunityAssistantCapability, 10_000); stellarCapabilityTimer.unref();
  const stellarPrivacyTimer = setInterval(() => stellarPrivacy.sweep(store.listTenants().map((tenant) => tenant.id)), 15 * 60_000); stellarPrivacyTimer.unref();

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
      if (request.method === "GET" && url.pathname === "/health/stellar") {
        const status = communityAssistant.status();
        const workers = executionJobs.listWorkers({ executionOwner: "stellar-core", executionTarget: "sprite", capabilityId: STELLAR_CHAT_CAPABILITY_ID, freshOnly: true });
        return json(response, status.availability === "available" ? 200 : 503, { schemaVersion: 1, availability: status.availability, ...(status.availability === "unavailable" ? { reason: status.unavailableReason } : {}), workers: workers.map((worker) => ({ workerId: worker.workerId, state: worker.state, providerHealthy: worker.providerHealthy, executionTarget: worker.executionTarget, lastHeartbeatAt: worker.lastHeartbeatAt, leaseExpiresAt: worker.leaseExpiresAt, metrics: worker.metrics })), buildSha: options.buildSha ?? "dev" });
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

      if (request.method === "GET" && url.pathname === "/v1/usage/me") {
        const token = accessToken(request), tenantId = header(request, "x-spmt-tenant");
        if (!token || !tenantId) return json(response, 401, { error: "unauthorized" });
        try {
          let principal;
          try { principal = auth.authorize(token, "usage:read", tenantId); }
          catch { principal = auth.authorize(token, "entitlements:read", tenantId); }
          if (principal.actorType !== "user") return json(response, 403, { error: "user_required" });
          return json(response, 200, billing.summary(tenantId, principal.actorId, billingPlan(control.listEntitlements(tenantId))));
        } catch { return json(response, 403, { error: "forbidden" }); }
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
        installSandboxApps(control, tenantId, options.sandboxApps ?? []);
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

      if (request.method === "GET" && url.pathname === "/v1/commlink/live") {
        const token = accessToken(request), tenantId = header(request, "x-spmt-tenant");
        if (!token || !tenantId) return json(response, 401, { error: "unauthorized" });
        try {
          auth.authorize(token, "commlink:read", tenantId);
          const provider = url.searchParams.get("provider") ?? undefined;
          if (provider && !["twitch", "discord", "kick"].includes(provider)) return json(response, 400, { error: "invalid_provider" });
          const limitValue = url.searchParams.get("limit");
          const limit = limitValue === null ? undefined : Number(limitValue);
          return json(response, 200, commlinkLiveChat.list({ tenantId, ...(provider ? { provider: provider as ChatProviderV1 } : {}), ...(url.searchParams.get("channelId") ? { channelId: url.searchParams.get("channelId")! } : {}), ...(url.searchParams.get("search") ? { search: url.searchParams.get("search")! } : {}), ...(limit === undefined ? {} : { limit }) }));
        } catch (error) {
          if (error instanceof Error && /limit|channelId|provider/.test(error.message)) return json(response, 400, { error: "invalid_query", message: error.message });
          return json(response, 403, { error: "forbidden" });
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/commlink/live") {
        const token = accessToken(request), tenantId = header(request, "x-spmt-tenant");
        if (!token || !tenantId) return json(response, 401, { error: "unauthorized" });
        try {
          const principal = auth.authorize(token, "commlink:live:write", tenantId);
          if (principal.actorType !== "service" || principal.actorId !== "chat-gateway") return json(response, 403, { error: "chat_gateway_required" });
          control.getApp(principal.actorId);
          if (!control.listInstalls(tenantId).some((install) => install.appId === principal.actorId && install.enabled)) return json(response, 403, { error: "app_not_installed" });
          const body = await readBody(request);
          const message = assertNormalizedChatMessageV1(body as unknown as NormalizedChatMessageV1);
          if (message.tenantId !== tenantId) return json(response, 403, { error: "tenant_mismatch" });
          return json(response, 201, commlinkLiveChat.ingest(message));
        } catch (error) {
          if (error instanceof AuthDeniedError) return json(response, 403, { error: "forbidden" });
          if (error instanceof Error && /chat|message|actor|version|invalid/i.test(error.message)) return json(response, 400, { error: "invalid_message", message: error.message });
          return json(response, 403, { error: "forbidden" });
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/provider-grants") {
        const token = accessToken(request), tenantId = header(request, "x-spmt-tenant");
        if (!token || !tenantId) return json(response, 401, { error: "unauthorized" });
        if (!providerGrants) return json(response, 503, { error: "provider_grants_unavailable" });
        try {
          const principal = auth.authorize(token, "providers:grant", tenantId);
          if (principal.actorType !== "service") return json(response, 403, { error: "service_required" });
          control.getApp(principal.actorId);
          if (!control.listInstalls(tenantId).some((install) => install.appId === principal.actorId && install.enabled)) return json(response, 403, { error: "app_not_installed" });
          const body = await readBody(request);
          const grant = await providerGrants.issue({ schemaVersion: 1, tenantId, requesterAppId: principal.actorId, provider: str(body.provider, "provider") as "discord" | "twitch" | "kick" | "xbox" | "github" | "livekit", providerUserId: str(body.providerUserId, "providerUserId"), capabilityId: str(body.capabilityId, "capabilityId"), requiredScopes: stringValues(body.requiredScopes, "requiredScopes"), ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: safeInteger(body.ttlSeconds, "ttlSeconds") }) });
          authority.audit({ tenantId, actorType: "service", actorId: principal.actorId, action: "provider-grants.issue", target: `provider:${grant.provider}:${grant.providerUserId}:${grant.capabilityId}`, outcome: "accepted" });
          return json(response, 201, grant);
        } catch (error) {
          if (error instanceof ProviderGrantError) return json(response, error.code === "unavailable" ? 503 : error.code === "denied" ? 403 : 400, { error: error.code, message: error.message });
          return json(response, 403, { error: "forbidden" });
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/provider-grants/recover") {
        const token = accessToken(request), tenantId = header(request, "x-spmt-tenant");
        if (!token || !tenantId) return json(response, 401, { error: "unauthorized" });
        if (!providerCredentials) return json(response, 503, { error: "provider_refresh_unavailable" });
        try {
          const principal = auth.authorize(token, "providers:grant", tenantId);
          if (principal.actorType !== "service") return json(response, 403, { error: "service_required" });
          control.getApp(principal.actorId);
          if (!control.listInstalls(tenantId).some((install) => install.appId === principal.actorId && install.enabled)) return json(response, 403, { error: "app_not_installed" });
          const body = await readBody(request);
          const provider = str(body.provider, "provider") as "discord" | "twitch" | "kick" | "xbox" | "github" | "livekit";
          const providerUserId = str(body.providerUserId, "providerUserId");
          const result = await providerCredentials.recover({ tenantId, provider, providerUserId, reason: str(body.reason, "reason") });
          authority.audit({ tenantId, actorType: "service", actorId: principal.actorId, action: "provider-grants.recover", target: `provider:${provider}:${providerUserId}`, outcome: result.status === "ready" ? "accepted" : "denied" });
          return json(response, result.status === "unavailable" ? 503 : 200, result);
        } catch (error) {
          if (error instanceof ProviderGrantError) return json(response, error.code === "unavailable" ? 503 : error.code === "denied" ? 403 : 400, { error: error.code, message: error.message });
          return json(response, 403, { error: "forbidden" });
        }
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
    store, platformStore, setupStore, commlinkLiveChat, authority, auth, control, billing, data, accounts, executionJobs, stellarPrivacy, operations, outbox, providerCredentials, server,
    registerOAuthClient(input: Parameters<PlatformDataService["registerOAuthClient"]>[0]): ReturnType<PlatformDataService["registerOAuthClient"]> { return data.registerOAuthClient(input); },
    runOutboxOnce() { return outbox.runOnce(); },
    runStellarPrivacySweep() { return stellarPrivacy.sweep(store.listTenants().map((tenant) => tenant.id)); },
    listen() { return new Promise<void>((done, reject) => { server.once("error", reject); server.listen(options.port ?? 3000, options.host ?? "0.0.0.0", () => { server.off("error", reject); done(); }); }); },
    close() { clearInterval(stellarCapabilityTimer); clearInterval(stellarPrivacyTimer); return new Promise<void>((done, reject) => server.close((error) => { providerCredentials?.close(); commlinkLiveChat.close(); setupStore.close(); platformStore.close(); store.close(); error ? reject(error) : done(); })); },
  };
}

export function validateSandboxServiceEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.SPMT_RUNTIME_MODE !== "sandbox") throw new Error("SPMT_RUNTIME_MODE=sandbox is required");
  if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("SPMT_OUTBOUND_MODE=disabled is required");
  if (!environment.SPMT_SANDBOX_ID || !/^[a-z0-9-]{3,80}$/.test(environment.SPMT_SANDBOX_ID)) throw new Error("SPMT_SANDBOX_ID must be a lowercase sandbox namespace");
  const forbidden = ["SPMT_PROVIDER_CREDENTIAL_KEY", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_BOT_OAUTH_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PROJECT_ID", "NEXT_PUBLIC_YOUTUBE_INNERTUBE_API_KEY", "YOUTUBE_API_KEY", "FLY_API_TOKEN", "SPRITES_TOKEN"].filter((name) => Boolean(environment[name]));
  if (forbidden.length) throw new Error(`Sandbox SPMT rejects provider or infrastructure credentials: ${forbidden.join(", ")}`);
  const databasePath = environment.DATABASE_PATH;
  if (!databasePath || !isAbsolute(databasePath) || !basename(databasePath).toLowerCase().includes("sandbox")) throw new Error("DATABASE_PATH must be an absolute sandbox-named SQLite path");
  const publicBaseUrl = requireSandboxPublicUrl(environment.SPMT_PUBLIC_URL);
  const host = environment.SPMT_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Sandbox SPMT must bind only to loopback through SPMT_HOST");
  if (!["0", "1"].includes(environment.SPMT_SANDBOX_FIXTURES ?? "")) throw new Error("SPMT_SANDBOX_FIXTURES must be 0 or 1");
  const sandboxOwnerUsername = environment.SPMT_SANDBOX_OWNER_USERNAME?.trim().toLowerCase();
  if (sandboxOwnerUsername && !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(sandboxOwnerUsername)) throw new Error("SPMT_SANDBOX_OWNER_USERNAME is invalid");
  const sandboxApps = parseSandboxApps(environment.SPMT_SANDBOX_APPS);
  return { databasePath, publicBaseUrl, host, sandboxApps, ...(sandboxOwnerUsername ? { sandboxOwnerUsername } : {}) };
}

function parseSandboxApps(source: string | undefined): AppCatalogRegistrationV1[] {
  if (!source) return [];
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("SPMT_SANDBOX_APPS must be valid JSON"); }
  if (!Array.isArray(value) || value.length > 50) throw new Error("SPMT_SANDBOX_APPS must be an array of at most 50 app manifests");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`SPMT_SANDBOX_APPS[${index}] must be an app manifest`);
    const item = entry as Record<string, unknown>;
    if (typeof item.appId !== "string" || typeof item.name !== "string" || typeof item.description !== "string" || typeof item.version !== "string" || typeof item.launchUrl !== "string" || !Array.isArray(item.allowedScopes) || !Array.isArray(item.surfaces) || (item.status !== "active" && item.status !== "disabled")) throw new Error(`SPMT_SANDBOX_APPS[${index}] is incomplete`);
    return item as unknown as AppCatalogRegistrationV1;
  });
}

function seedSandboxApps(control: ControlService, tenants: Array<{ id: string }>, manifests: AppCatalogRegistrationV1[]) {
  manifests.forEach((manifest) => registerFixture(control, manifest));
  tenants.forEach((tenant) => installSandboxApps(control, tenant.id, manifests));
}

function installSandboxApps(control: ControlService, tenantId: string, manifests: AppCatalogRegistrationV1[]) {
  manifests.filter((manifest) => manifest.status === "active").forEach((manifest) => control.installApp(tenantId, manifest.appId, manifest.allowedScopes));
}

function seedSandboxFixtures(control: ControlService, data: PlatformDataService, publicBaseUrl: string) {
  registerFixture(control, {
    appId: "spacemountain",
    name: "SpaceMountain",
    description: "The Green command bridge for SPMT identity, Shipyard, Commlink, workspace, and Stellar Core surfaces.",
    version: "0.1.0-sandbox",
    launchUrl: new URL("/", publicBaseUrl).toString(),
    allowedScopes: ["workspace:read", "xp:read", "apps:read", "apps:install", "entitlements:read", "usage:read", "events:read", "commlink:read", "notifications:read", "assistants:read", "assistants:invoke", "stellar:context:read", "stellar:capabilities:read", "operations:logs:read", "operations:coder:read", "operations:coder:invoke"],
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
function stringValues(value: unknown, name: string) { if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string" || !item)) throw new Error(`${name} must be a non-empty string array`); return value as string[]; }
function safeInteger(value: unknown, name: string) { if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`); return value as number; }
function header(request: IncomingMessage, name: string) { const value = request.headers[name]; return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function accessToken(request: IncomingMessage) { const authorization = request.headers.authorization; if (authorization?.startsWith("Bearer ")) return authorization.slice(7); return cookie(request, "spmt_token"); }
function cookie(request: IncomingMessage, name: string) { const source = request.headers.cookie ?? ""; for (const item of source.split(";")) { const [index, ...rest] = item.trim().split("="); if (index === name) return decodeURIComponent(rest.join("=")); } return undefined; }
function sessionCookie(token: string) { return `spmt_token=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function setupCookie(name: string, token: string) { return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`; }
function clearCookie(name: string) { return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
function isIdentity(value: unknown): value is { id: string; username?: string } { return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"); }
function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) { const encoded = JSON.stringify(body); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(encoded), ...headers }); response.end(encoded); }
function redirectSetupError(response: ServerResponse, base: string, message: string) { const target = new URL("/first-time-setup", base); target.searchParams.set("setupError", message); response.writeHead(302, { location: target.toString(), "cache-control": "no-store" }); response.end(); }
function decodeKey(value: string) { const key = Buffer.from(value, "base64url"); if (key.byteLength !== 32) throw new Error("SPMT_WEBHOOK_KEY must be base64url for exactly 32 bytes"); return key; }
function loadBillingManifest() { return assertBillingManifestV1(JSON.parse(readFileSync(new URL("../../../config/billing-plans.v1.json", import.meta.url), "utf8")) as BillingManifestV1); }
function billingPlan(entitlements: Array<{ key: string; value: string | number | boolean }>): BillingPlanIdV1 {
  for (const entitlement of entitlements) if (["billing.plan", "billing-plan", "plan", "tier"].includes(entitlement.key) && typeof entitlement.value === "string" && (BILLING_PLAN_IDS as readonly string[]).includes(entitlement.value)) return entitlement.value as BillingPlanIdV1;
  return "free";
}
function resolveStellarRoute(control: ControlService, jobs: ExecutionJobService, tenantId: string, preference: "automatic" | "hosted" | "companion") {
  const plan = billingPlan(control.listEntitlements(tenantId));
  const companionInstalled = control.listInstalls(tenantId).some((install) => install.appId === "companion" && install.enabled);
  const companionReady = companionInstalled && jobs.hasReadyWorker({ executionOwner: "stellar-core", executionTarget: "companion", capabilityId: STELLAR_CHAT_CAPABILITY_ID, tenantId });
  if (preference === "companion" && plan !== "free" && companionReady) return { executionTarget: "companion" as const, meteringTarget: "companion" as const };
  if (preference === "companion") return { executionTarget: "sprite" as const, meteringTarget: "hosted" as const, fallbackReason: plan === "free" ? "Companion routing requires a paid plan; hosted routing was selected." : "Companion is not connected and ready; hosted routing was selected." };
  return { executionTarget: "sprite" as const, meteringTarget: "hosted" as const };
}
function ensureStellarWorkerIdentity(auth: AuthService, credential: string) {
  try { auth.registerServiceIdentity({ serviceId: "stellar-core", credential, scopes: ["jobs:read", "jobs:work", "stellar:context:read"], tenantMode: "any" }); }
  catch (error) { if (!(error instanceof AuthConflictError)) throw error; auth.rotateServiceCredential("stellar-core", credential); }
}
function ensureChatGatewayIdentity(auth: AuthService, credential: string) {
  try { auth.registerServiceIdentity({ serviceId: "chat-gateway", credential, scopes: ["providers:grant", "commlink:live:write", "runtime:write"], tenantMode: "any" }); }
  catch (error) { if (!(error instanceof AuthConflictError)) throw error; auth.rotateServiceCredential("chat-gateway", credential); }
}
function ensureStreamWeaverIdentity(auth: AuthService, credential: string) {
  const scopes = ["identity:read", "identity:write", "assistants:invoke", "jobs:read", "xp:write", "runtime:write"];
  try { auth.registerServiceIdentity({ serviceId: "streamweaver", credential, scopes, tenantMode: "any" }); }
  catch (error) { if (!(error instanceof AuthConflictError)) throw error; auth.rotateServiceCredential("streamweaver", credential); }
}
function ensureDshIdentity(auth: AuthService, credential: string) {
  try { auth.registerServiceIdentity({ serviceId: "discord-stream-hub", credential, scopes: ["providers:grant", "runtime:write"], tenantMode: "any" }); }
  catch (error) { if (!(error instanceof AuthConflictError)) throw error; auth.rotateServiceCredential("discord-stream-hub", credential); }
}
function syncCommunityAssistantCapability(data: PlatformDataService, status: ReturnType<CommunityAssistantRuntimeV1["status"]>) {
  data.upsertStellarCapability({ id: "spmt.community-assistant", sourceAppId: "stellar-core", title: "Stella Community Assistant", description: "Invoke the app-neutral SPMT Community Assistant through the durable, metered Stellar Core job contract.", requiredScopes: ["assistants:invoke"], availability: status.availability, ...(status.availability === "unavailable" ? { unavailableReason: status.unavailableReason } : {}) });
}
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
  const discordClientId = process.env.DISCORD_CLIENT_ID;
  const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
  const kickClientId = process.env.KICK_CLIENT_ID;
  const kickClientSecret = process.env.KICK_CLIENT_SECRET;
  const providerCredentialKeySource = process.env.SPMT_PROVIDER_CREDENTIAL_KEY;
  const providerCredentialKey = providerCredentialKeySource ? decodeKey(providerCredentialKeySource) : undefined;
  const providerOAuthClients = {
    ...(twitchClientId && twitchClientSecret ? { twitch: { clientId: twitchClientId, clientSecret: twitchClientSecret } } : {}),
    ...(discordClientId && discordClientSecret ? { discord: { clientId: discordClientId, clientSecret: discordClientSecret } } : {}),
    ...(kickClientId && kickClientSecret ? { kick: { clientId: kickClientId, clientSecret: kickClientSecret } } : {}),
  };
  const discordBotToken = process.env.DISCORD_BOT_TOKEN;
  const stellarWorkerCredential = process.env.STELLAR_WORKER_CREDENTIAL;
  const stellarChatEnabled = process.env.SPMT_STELLAR_CHAT_ENABLED === "1";
  if (stellarChatEnabled && !stellarWorkerCredential) throw new Error("SPMT_STELLAR_CHAT_ENABLED=1 requires STELLAR_WORKER_CREDENTIAL");
  const chatGatewayCredential = process.env.CHAT_GATEWAY_WORKER_CREDENTIAL;
  const chatGatewayEnabled = process.env.SPMT_CHAT_GATEWAY_ENABLED === "1";
  if (chatGatewayEnabled && !chatGatewayCredential) throw new Error("SPMT_CHAT_GATEWAY_ENABLED=1 requires CHAT_GATEWAY_WORKER_CREDENTIAL");
  const streamweaverWorkerCredential = process.env.STREAMWEAVER_WORKER_CREDENTIAL;
  const streamweaverProviderRuntimeEnabled = process.env.SPMT_STREAMWEAVER_PROVIDER_RUNTIME_ENABLED === "1";
  if (streamweaverProviderRuntimeEnabled && !streamweaverWorkerCredential) throw new Error("SPMT_STREAMWEAVER_PROVIDER_RUNTIME_ENABLED=1 requires STREAMWEAVER_WORKER_CREDENTIAL");
  const dshWorkerCredential = process.env.DSH_WORKER_CREDENTIAL;
  const dshLiveRuntimeEnabled = process.env.SPMT_DSH_LIVE_RUNTIME_ENABLED === "1";
  if (dshLiveRuntimeEnabled && !dshWorkerCredential) throw new Error("SPMT_DSH_LIVE_RUNTIME_ENABLED=1 requires DSH_WORKER_CREDENTIAL");
  const service = createSpmtService({
    databasePath,
    webhookKey: decodeKey(key),
    port: Number(process.env.PORT ?? 3000),
    publicBaseUrl,
    runtimeMode,
    sandboxFixtures: runtimeMode === "sandbox" && process.env.SPMT_SANDBOX_FIXTURES === "1",
    ...(checked?.sandboxOwnerUsername ? { sandboxOwnerUsername: checked.sandboxOwnerUsername } : {}),
    ...(checked?.sandboxApps.length ? { sandboxApps: checked.sandboxApps } : {}),
    ...(checked?.host ? { host: checked.host } : {}),
    ...(buildSha ? { buildSha } : {}),
    ...(twitchClientId ? { twitchClientId } : {}),
    ...(twitchClientSecret ? { twitchClientSecret } : {}),
    ...(providerCredentialKey ? { providerCredentialKey, providerOAuthClients } : {}),
    ...(discordBotToken ? { discordBotToken } : {}),
    stellarChatEnabled,
    ...(stellarWorkerCredential ? { stellarWorkerCredential } : {}),
    chatGatewayEnabled,
    ...(chatGatewayCredential ? { chatGatewayCredential } : {}),
    streamweaverProviderRuntimeEnabled,
    ...(streamweaverWorkerCredential ? { streamweaverWorkerCredential } : {}),
    dshLiveRuntimeEnabled,
    ...(dshWorkerCredential ? { dshWorkerCredential } : {}),
  });
  await service.listen();
}
