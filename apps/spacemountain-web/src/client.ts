import { SpmtApiError, SpmtClient } from "@spmt/sdk";
import type { AppCatalogRegistrationV1, OperationsLogV1 } from "@spmt/contracts";
import { SpaceMountainShellController, buildAppFrameTarget, type SpaceMountainAppCardV1 } from "@spmt/spacemountain";
import { SpaceMountainShellUi } from "@spmt/spacemountain/ui";

type Principal = { actorId: string; tenantIds: string[]; scopes: string[] };

const authView = element<HTMLElement>("auth-view");
const shellView = element<HTMLElement>("shell-view");
const shellRoot = element<HTMLElement>("spacemountain-root");
const status = element<HTMLElement>("sandbox-status");
const refreshButton = element<HTMLButtonElement>("refresh-shell");
const logoutButton = element<HTMLButtonElement>("logout");
const openDeveloperButton = element<HTMLButtonElement>("open-developer-console");
const developerDialog = element<HTMLDialogElement>("developer-dialog");
const closeDeveloperButton = element<HTMLButtonElement>("close-developer-console");
const developerForm = element<HTMLFormElement>("developer-form");
const manifestUrlInput = element<HTMLInputElement>("developer-manifest-url");
const manifestJsonInput = element<HTMLTextAreaElement>("developer-manifest-json");
const importManifestButton = element<HTMLButtonElement>("import-developer-manifest");
const loadJsonButton = element<HTMLButtonElement>("load-developer-json");
const loadCandidateButton = document.querySelector<HTMLButtonElement>("#load-candidate-example") ?? undefined;
const manifestPreview = element<HTMLElement>("developer-manifest-preview");
const acknowledgement = element<HTMLInputElement>("developer-acknowledgement");
const resetDeveloperButton = element<HTMLButtonElement>("reset-developer-form");
const registerDeveloperButton = element<HTMLButtonElement>("register-developer-app");
const loginForm = element<HTMLFormElement>("login-form");
const registerForm = element<HTMLFormElement>("register-form");
const dialog = element<HTMLDialogElement>("record-dialog");
const dialogTitle = element<HTMLElement>("record-dialog-title");
const dialogBody = element<HTMLElement>("record-dialog-body");

const spmt = new SpmtClient({
  baseUrl: window.location.origin,
  appId: "spacemountain",
  fetchImpl: (input, init) => fetch(input, { ...init, credentials: "same-origin" }),
});
const controller = new SpaceMountainShellController(spmt);
let shellUi: SpaceMountainShellUi | undefined;
let currentPrincipal: Principal | undefined;
let loading = false;
let registryFingerprint = "";
let registeredAppIds = new Set<string>();

loginForm.addEventListener("submit", (event) => void submitLogin(event));
registerForm.addEventListener("submit", (event) => void submitRegistration(event));
refreshButton.addEventListener("click", () => void loadShell().catch((error) => setStatus(message(error), "error")));
logoutButton.addEventListener("click", () => void logout());
openDeveloperButton.addEventListener("click", () => openDeveloperConsole());
closeDeveloperButton.addEventListener("click", () => developerDialog.close());
developerForm.addEventListener("input", (event) => { if (event.target !== acknowledgement) updateManifestPreview(); });
developerForm.addEventListener("submit", (event) => void registerDeveloperApp(event));
importManifestButton.addEventListener("click", () => void importDeveloperManifest());
loadJsonButton.addEventListener("click", () => void loadPastedManifest());
loadCandidateButton?.addEventListener("click", () => void loadCandidateExample());
resetDeveloperButton.addEventListener("click", () => resetDeveloperForm());
window.setInterval(() => void watchRegistry(), 20_000);
window.addEventListener("spmt:easter-egg-complete", (event) => void recordEggCompletion(event as CustomEvent));

void boot();

async function boot() {
  try {
    await loadShell();
  } catch (error) {
    if (error instanceof SpmtApiError && (error.status === 401 || error.status === 403)) {
      showAuth("Create or sign in to an isolated sandbox account.");
      return;
    }
    showAuth(message(error));
  }
}

async function submitLogin(event: SubmitEvent) {
  event.preventDefault();
  try {
    const input = authInput(loginForm, false);
    await authRequest("/sandbox/auth/login", input, loginForm);
  } catch (error) { setStatus(message(error), "error"); }
}

async function submitRegistration(event: SubmitEvent) {
  event.preventDefault();
  try {
    const input = authInput(registerForm, true);
    await authRequest("/sandbox/auth/register", input, registerForm);
  } catch (error) { setStatus(message(error), "error"); }
}

async function authRequest(path: string, input: Record<string, string>, form: HTMLFormElement) {
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (button) button.disabled = true;
  setStatus("Opening the isolated SPMT session…", "working");
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`);
    form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((node) => { node.value = ""; });
    await loadShell();
  } catch (error) {
    setStatus(message(error), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadShell() {
  if (loading) return;
  loading = true;
  setStatus("Reading the local SPMT authority…", "working");
  try {
    const principal = parsePrincipal(await spmt.getSession());
    const snapshot = await controller.load({ tenantId: principal.tenantIds[0]!, userId: principal.actorId });
    registryFingerprint = registrySignature(snapshot.apps);
    registeredAppIds = new Set(snapshot.apps.map((app) => app.appId));
    currentPrincipal = principal;
    authView.hidden = true;
    shellView.hidden = false;
    refreshButton.hidden = false;
    logoutButton.hidden = false;
    openDeveloperButton.hidden = !principal.scopes.includes("apps:register");
    if (shellUi) shellUi.update(snapshot);
    else shellUi = new SpaceMountainShellUi({
      root: shellRoot,
      snapshot,
      onInstallApp: (app) => void installApp(app),
      onLaunchApp: (app) => launchApp(app),
      onOpenConversation: (conversation) => void openConversation(conversation),
      onSearchCommlink: (query) => void searchCommlink(query),
      onSendCommlinkMessage: (conversation, text) => void sendCommlinkMessage(conversation, text),
      onInvokeStella: (message, conversationId, routingPreference) => void invokeStella(message, conversationId, routingPreference),
      onMarkNotificationRead: (notification) => void markNotificationRead(notification),
      onUnlinkProvider: (link) => void unlinkProvider(link),
      onSaveWorkspace: (expectedRevision, patch) => void saveWorkspace(expectedRevision, patch),
      onPrepareCoderLog: (log) => void prepareCoderLog(log),
      onPrepareCoderPrompt: (appId, prompt) => void prepareCoderPrompt(appId, prompt),
      onIssueOverlayOutput: (appId, widgetId, personal) => void issueOverlayOutput(appId, widgetId, personal),
      onRevokeOverlayOutput: (grantId) => void revokeOverlayOutput(grantId),
    }).mount();
    setStatus("Sandbox open", "ready");
    if (window.location.hash === "#developer-console" && !openDeveloperButton.hidden && !developerDialog.open) openDeveloperConsole();
  } finally {
    loading = false;
  }
}

function openDeveloperConsole() {
  if (!currentPrincipal?.scopes.includes("apps:register")) {
    setStatus("This account does not have apps:register permission.", "error");
    return;
  }
  updateManifestPreview();
  if (!developerDialog.open) developerDialog.showModal();
}

async function importDeveloperManifest() {
  const manifestUrl = manifestUrlInput.value.trim();
  if (!manifestUrl) return setStatus("Enter an HTTPS manifest URL first.", "error");
  importManifestButton.disabled = true;
  setStatus("Importing the developer manifest for review…", "working");
  try {
    const response = await fetch("/sandbox/developer/import-manifest", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifestUrl }),
    });
    const payload = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) throw new Error(apiMessage(payload, `Manifest import failed (${response.status})`));
    loadManifestIntoForm(payload);
    setStatus("Manifest imported. Review every field before registering it.", "ready");
  } catch (error) { setStatus(message(error), "error"); }
  finally { importManifestButton.disabled = false; }
}

function loadPastedManifest() {
  try {
    if (!manifestJsonInput.value.trim()) throw new Error("Paste a manifest JSON object first.");
    loadManifestIntoForm(JSON.parse(manifestJsonInput.value));
    setStatus("Pasted manifest loaded. Review every field before registering it.", "ready");
  } catch (error) { setStatus(message(error), "error"); }
}

async function loadCandidateExample() {
  if (!loadCandidateButton) return;
  loadCandidateButton.disabled = true;
  setStatus("Loading the editable Nebula Arcade example…", "working");
  try {
    const response = await fetch("/sandbox/candidate-app", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) throw new Error(apiMessage(payload, "The Nebula Arcade example manifest is unavailable."));
    loadManifestIntoForm(payload);
    setStatus("Nebula Arcade example loaded. Nothing has been registered yet.", "ready");
  } catch (error) { setStatus(message(error), "error"); }
  finally { loadCandidateButton.disabled = false; }
}

async function registerDeveloperApp(event: SubmitEvent) {
  event.preventDefault();
  if (!developerForm.reportValidity()) return;
  try {
    const manifest = manifestFromForm();
    if (!acknowledgement.checked) throw new Error("Review and acknowledge the exact registration payload first.");
    if (registeredAppIds.has(manifest.appId) && !window.confirm(`${manifest.appId} already exists. Register this manifest as its updated catalog record?`)) return;
    registerDeveloperButton.disabled = true;
    setStatus(`Registering ${manifest.name} through the public SPMT SDK…`, "working");
    await spmt.registerApp(manifest);
    developerDialog.close();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    await loadShell();
    setStatus(`${manifest.name} is registered. Install it from Shipyard when you are ready to grant tenant scopes.`, "ready");
  } catch (error) { setStatus(message(error), "error"); }
  finally { registerDeveloperButton.disabled = false; }
}

function loadManifestIntoForm(value: unknown) {
  const manifest = normalizeManifest(value);
  setNamedValue("appId", manifest.appId);
  setNamedValue("name", manifest.name);
  setNamedValue("description", manifest.description);
  setNamedValue("version", manifest.version);
  setNamedValue("launchUrl", manifest.launchUrl);
  setNamedValue("iconUrl", manifest.iconUrl ?? "");
  setNamedValue("allowedScopes", manifest.allowedScopes.join(", "));
  setNamedValue("status", manifest.status);
  developerForm.querySelectorAll<HTMLInputElement>('input[name="surfaces"]').forEach((input) => { input.checked = manifest.surfaces.includes(input.value as AppCatalogRegistrationV1["surfaces"][number]); });
  acknowledgement.checked = false;
  manifestJsonInput.value = JSON.stringify(manifest, null, 2);
  updateManifestPreview();
}

function resetDeveloperForm() {
  developerForm.reset();
  manifestUrlInput.value = "";
  manifestJsonInput.value = "";
  acknowledgement.checked = false;
  updateManifestPreview();
}

function updateManifestPreview() {
  try { manifestPreview.textContent = JSON.stringify(manifestFromForm(), null, 2); }
  catch (error) { manifestPreview.textContent = message(error); }
  acknowledgement.checked = false;
}

function manifestFromForm() {
  const data = new FormData(developerForm);
  return normalizeManifest({
    appId: data.get("appId"), name: data.get("name"), description: data.get("description"), version: data.get("version"),
    launchUrl: data.get("launchUrl"), iconUrl: data.get("iconUrl") || undefined, status: data.get("status"),
    allowedScopes: String(data.get("allowedScopes") ?? "").split(/[\s,]+/).filter(Boolean),
    surfaces: data.getAll("surfaces"),
  });
}

function normalizeManifest(value: unknown): AppCatalogRegistrationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The manifest must be a JSON object.");
  const item = value as Record<string, unknown>;
  const appId = manifestText(item.appId, "appId", 200);
  if (!/^[A-Za-z0-9._:@/-]+$/.test(appId)) throw new Error("appId contains unsupported characters.");
  const name = manifestText(item.name, "name", 120);
  const description = manifestText(item.description, "description", 1000);
  const version = manifestText(item.version, "version", 80);
  const launchUrl = manifestUrl(item.launchUrl, "launchUrl");
  const iconUrl = item.iconUrl === undefined || item.iconUrl === "" ? undefined : manifestUrl(item.iconUrl, "iconUrl");
  const allowedScopes = manifestStringArray(item.allowedScopes, "allowedScopes").map((scope) => scope.trim()).filter(Boolean);
  if (allowedScopes.some((scope) => scope.length > 120 || !/^[A-Za-z0-9.*:_-]+$/.test(scope))) throw new Error("allowedScopes contains an invalid scope.");
  const surfaces = manifestStringArray(item.surfaces, "surfaces");
  const allowedSurfaces = ["shell", "standalone", "overlay", "popout"] as const;
  if (!surfaces.length || surfaces.some((surface) => !allowedSurfaces.includes(surface as typeof allowedSurfaces[number]))) throw new Error("Choose at least one valid app surface.");
  if (item.status !== "active" && item.status !== "disabled") throw new Error("status must be active or disabled.");
  return { appId, name, description, version, launchUrl, ...(iconUrl ? { iconUrl } : {}), allowedScopes: [...new Set(allowedScopes)].sort(), surfaces: [...new Set(surfaces)] as AppCatalogRegistrationV1["surfaces"], status: item.status };
}

function manifestText(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > max) throw new Error(`${name} is required and must be at most ${max} characters.`);
  return value;
}

function manifestStringArray(value: unknown, name: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name} must be an array of strings.`);
  return value as string[];
}

function manifestUrl(value: unknown, name: string) {
  const text = manifestText(value, name, 2048);
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`${name} must be an absolute URL.`); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error(`${name} must use HTTPS outside localhost.`);
  if (url.username || url.password) throw new Error(`${name} may not contain embedded credentials.`);
  return url.toString();
}

function setNamedValue(name: string, value: string) {
  const field = developerForm.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = value;
}

async function installApp(app: SpaceMountainAppCardV1) {
  const principal = requirePrincipal();
  const scopeText = app.allowedScopes.length ? app.allowedScopes.join(", ") : "no delegated scopes";
  if (!window.confirm(`Install ${app.name} in this sandbox with ${scopeText}?`)) return;
  setStatus(`Installing ${app.name} through the public SPMT SDK…`, "working");
  try {
    await controller.installApp(principal.tenantIds[0]!, app.appId, app.allowedScopes);
    await loadShell();
  } catch (error) { setStatus(message(error), "error"); }
}

function launchApp(app: SpaceMountainAppCardV1) {
  try {
    const principal = requirePrincipal();
    const mode = app.surfaces.includes("standalone") ? "standalone" : app.surfaces[0];
    if (!mode) throw new Error(`${app.name} has no launch surface`);
    const target = buildAppFrameTarget(app, principal.tenantIds[0]!, mode, crypto.randomUUID());
    const opened = window.open(target.url, "_blank", "noopener,noreferrer");
    if (!opened) setStatus("The browser blocked the app window. Allow pop-ups for this private Sprite and try again.", "error");
  } catch (error) { setStatus(message(error), "error"); }
}

async function openConversation(conversation: Record<string, unknown>) {
  const principal = requirePrincipal();
  const id = typeof conversation.id === "string" ? conversation.id : "";
  if (!id) return;
  setStatus("Loading Commlink messages…", "working");
  try {
    const messages = await controller.loadConversationMessages(principal.tenantIds[0]!, id) as Array<Record<string, unknown>>;
    dialogTitle.textContent = typeof conversation.title === "string" ? conversation.title : "Commlink conversation";
    dialogBody.replaceChildren(...messages.map(messageCard));
    if (!messages.length) dialogBody.append(textBlock("No messages yet."));
    const reply = conversationReplyForm(conversation, principal.actorId);
    if (reply) dialogBody.append(reply);
    if (!dialog.open) dialog.showModal();
    setStatus("Sandbox open · Commlink data came from SPMT.", "ready");
  } catch (error) { setStatus(message(error), "error"); }
}

async function searchCommlink(query: string) {
  const principal = requirePrincipal();
  setStatus(`Searching canonical Commlink history for “${query}”…`, "working");
  try {
    const results = await controller.searchCommlink(principal.tenantIds[0]!, query, principal.actorId) as Array<Record<string, unknown>>;
    dialogTitle.textContent = `Commlink search · ${query}`;
    dialogBody.replaceChildren(...results.map(messageCard));
    if (!results.length) dialogBody.append(textBlock("No matching messages."));
    if (!dialog.open) dialog.showModal();
    setStatus(`${results.length} canonical message match${results.length === 1 ? "" : "es"}.`, "ready");
  } catch (error) { setStatus(message(error), "error"); }
}

async function sendCommlinkMessage(conversation: Record<string, unknown>, text: string) {
  const principal = requirePrincipal();
  const conversationId = typeof conversation.id === "string" ? conversation.id : "";
  const recipients = Array.isArray(conversation.participantUserIds) ? conversation.participantUserIds.filter((item): item is string => typeof item === "string" && item !== principal.actorId) : [];
  if (!conversationId || !recipients.length) return setStatus("This Commlink source is read-only for the current account.", "error");
  setStatus("Sending through the canonical Commlink contract…", "working");
  try {
    await controller.sendCommlinkMessage(principal.tenantIds[0]!, conversationId, recipients, text);
    await loadShell();
    setStatus("Message stored in canonical Commlink history.", "ready");
  } catch (error) { setStatus(message(error), "error"); }
}

async function invokeStella(prompt: string, conversationId: string, routingPreference: "automatic" | "hosted" | "companion") {
  const principal = requirePrincipal();
  setStatus("Stella is thinking through Stellar Core…", "working");
  let turn: HTMLElement | undefined;
  try {
    const tenantId = principal.tenantIds[0]!;
    const result = await controller.invokeStella(tenantId, principal.actorId, prompt, conversationId, `stella-${crypto.randomUUID()}`, routingPreference) as Record<string, unknown>;
    if (result.status === "unavailable") {
      const reason = typeof result.reason === "string" ? result.reason : "Stellar Core is unavailable.";
      appendAssistantTurn(prompt, reason, "unavailable");
      return setStatus(`Stella unavailable · ${reason}`, "error");
    }
    if (typeof result.jobId !== "string") throw new Error("Stellar Core accepted the request without a job identifier");
    const queued = typeof result.fallbackReason === "string" ? `${result.fallbackReason} Request queued.` : "Request queued through Stellar Core.";
    turn = appendAssistantTurn(prompt, queued, "queued");
    void spmt.getPersonalUsage(tenantId).then((usage) => shellUi?.updatePersonalUsage(usage)).catch(() => undefined);
    await pollStellaJob(tenantId, result.jobId, turn);
  } catch (error) {
    const detail = message(error);
    if (turn) renderAssistantTurn(turn, detail, "failed"); else appendAssistantTurn(prompt, detail, "failed");
    setStatus(`Stella unavailable · ${detail}`, "error");
  }
}

function appendAssistantTurn(prompt: string, detail: string, state: string) {
  const history = shellRoot.querySelector<HTMLElement>("[data-stella-history]");
  if (!history) return undefined;
  const user = document.createElement("p"); user.innerHTML = `<b>You</b> · ${escapeText(prompt)}`;
  const stella = document.createElement("p"); renderAssistantTurn(stella, detail, state);
  history.append(user, stella);
  return stella;
}

async function pollStellaJob(tenantId: string, jobId: string, turn: HTMLElement | undefined) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const job = await spmt.getExecutionJob(tenantId, jobId);
    if (job.state === "succeeded") {
      const detail = job.result?.kind === "stellar-chat-result.v1" && typeof job.result.text === "string" ? job.result.text : "Stellar Core completed without a valid assistant result.";
      if (turn) renderAssistantTurn(turn, detail, typeof job.result?.text === "string" ? "complete" : "failed");
      setStatus(typeof job.result?.text === "string" ? "Stella completed the request." : detail, typeof job.result?.text === "string" ? "ready" : "error");
      return;
    }
    if (["failed", "dead-letter", "cancelled"].includes(job.state)) {
      const detail = job.error?.message ?? `Stellar Core job ${job.state}.`;
      if (turn) renderAssistantTurn(turn, detail, job.state);
      setStatus(`Stella · ${job.state}: ${detail}`, "error");
      return;
    }
    const detail = job.progress?.message ?? (job.state === "queued" && job.error?.retryable ? "The worker is retrying this request." : "Waiting for a Stellar Core worker…");
    if (turn) renderAssistantTurn(turn, detail, job.progress ? `${Math.round(job.progress.percent)}%` : job.state);
    await new Promise((done) => window.setTimeout(done, 1_000));
  }
  if (turn) renderAssistantTurn(turn, "This request is still queued. Its durable job remains available after you leave this page.", "still running");
  setStatus("Stella is still working on the durable request.", "working");
}

function renderAssistantTurn(node: HTMLElement, detail: string, state: string) {
  node.replaceChildren();
  const name = document.createElement("b"); name.textContent = "Stella";
  const status = document.createElement("small"); status.textContent = state;
  node.append(name, document.createTextNode(` · ${detail} `), status);
}

async function recordEggCompletion(event: CustomEvent) {
  const principal = requirePrincipal();
  const egg = event.detail?.egg;
  if (egg !== "blackHole" && egg !== "rocket" && egg !== "signal") return;
  const tenantId = principal.tenantIds[0]!;
  const type = `ecosystem.easter-egg.${egg}.completed.v1`;
  setStatus(`Retaining ${egg} discovery in canonical SPMT state…`, "working");
  try {
    await spmt.publishEvent(tenantId, type, { schemaVersion: 1, userId: principal.actorId, egg, completed: true }, `egg:${principal.actorId}:${egg}`);
    const events = await spmt.listEvents(tenantId, { limit: 100 });
    const found = new Set(events.filter((item) => item.payload && typeof item.payload === "object" && (item.payload as Record<string, unknown>).userId === principal.actorId).map((item) => item.type));
    const all = ["blackHole", "rocket", "signal"].every((name) => found.has(`ecosystem.easter-egg.${name}.completed.v1`));
    if (all) {
      const alreadyRewarded = found.has("ecosystem.easter-eggs.completed.v1");
      await spmt.publishEvent(tenantId, "ecosystem.easter-eggs.completed.v1", { schemaVersion: 1, userId: principal.actorId, reward: "lord-puzzler", assistant: "count-puzzle" }, `egg:${principal.actorId}:complete`);
      if (!alreadyRewarded) await spmt.createNotification(tenantId, principal.actorId, "achievement", "Lord Puzzler unlocked", "Count Puzzle has joined your ecosystem collection.");
    }
    setStatus(all ? "All three signals retained · Lord Puzzler unlocked." : `${egg} discovery retained.`, "ready");
  } catch (error) { setStatus(`Discovery was not retained · ${message(error)}`, "error"); }
}

function conversationReplyForm(conversation: Record<string, unknown>, actorId: string) {
  const recipients = Array.isArray(conversation.participantUserIds) ? conversation.participantUserIds.filter((item): item is string => typeof item === "string" && item !== actorId) : [];
  const conversationId = typeof conversation.id === "string" ? conversation.id : "";
  if (!conversationId || !recipients.length) return undefined;
  const form = document.createElement("form");
  form.className = "dialog-reply";
  const textarea = document.createElement("textarea");
  textarea.name = "reply";
  textarea.required = true;
  textarea.maxLength = 8000;
  textarea.placeholder = "Reply to this conversation";
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Send reply";
  form.append(textarea, button);
  form.addEventListener("submit", (event) => void (async () => {
    event.preventDefault();
    const principal = requirePrincipal();
    const text = textarea.value.trim();
    if (!text) return;
    button.disabled = true;
    setStatus("Sending through the public SPMT Commlink contract…", "working");
    try {
      await controller.sendCommlinkMessage(principal.tenantIds[0]!, conversationId, recipients, text);
      await openConversation(conversation);
      setStatus("Reply stored in canonical Commlink history.", "ready");
    } catch (error) { setStatus(message(error), "error"); }
    finally { button.disabled = false; }
  })());
  return form;
}

async function markNotificationRead(notification: Record<string, unknown>) {
  const principal = requirePrincipal();
  const id = typeof notification.id === "string" ? notification.id : "";
  if (!id) return;
  try {
    await controller.markNotificationRead(principal.tenantIds[0]!, id, principal.actorId);
    await loadShell();
  } catch (error) { setStatus(message(error), "error"); }
}

async function unlinkProvider(link: Record<string, unknown>) {
  const provider = typeof link.provider === "string" ? link.provider : "";
  const providerUserId = typeof link.providerUserId === "string" ? link.providerUserId : typeof link.provider_user_id === "string" ? link.provider_user_id : "";
  if (!provider || !providerUserId) return;
  if (!window.confirm(`Unlink ${provider} account ${providerUserId}? You may lose that sign-in path until it is verified and linked again.`)) return;
  setStatus(`Unlinking ${provider} through the public SPMT identity contract…`, "working");
  try {
    await controller.unlinkProvider(provider, providerUserId);
    await loadShell();
    setStatus(`${provider} account unlinked from this SPMT identity.`, "ready");
  } catch (error) { setStatus(message(error), "error"); }
}

async function saveWorkspace(expectedRevision: number, patch: Record<string, unknown>) {
  const principal = requirePrincipal();
  const tenantId = principal.tenantIds[0]!;
  setStatus("Saving the canonical SPMT workspace…", "working");
  try {
    try {
      await controller.saveWorkspace(tenantId, expectedRevision, patch);
    } catch (error) {
      if (!(error instanceof SpmtApiError) || ![409, 502, 503].includes(error.status)) throw error;
      const reconnecting = error.status === 502 || error.status === 503;
      setStatus(reconnecting ? "SPMT is reconnecting inside the Sprite; retrying the theme save…" : "Workspace changed in another ecosystem surface; reconciling the latest revision…", "working");
      if (reconnecting) await new Promise((done) => window.setTimeout(done, 750));
      const current = await spmt.getWorkspaceProfile(tenantId);
      const currentRevision = typeof current.revision === "number" ? current.revision : Number.NaN;
      if (!Number.isInteger(currentRevision) || currentRevision < 1) throw new Error("The latest workspace revision could not be read. Refresh and try again.");
      try {
        await controller.saveWorkspace(tenantId, currentRevision, patch);
      } catch (retryError) {
        if (retryError instanceof SpmtApiError && retryError.status === 409) throw new Error("The workspace changed again while saving. Refresh and submit the theme once more.");
        if (retryError instanceof SpmtApiError && [502, 503].includes(retryError.status)) throw new Error("SPMT is still restarting inside the Sprite. Wait a moment and save the theme again.");
        throw retryError;
      }
    }
    await loadShell();
    setStatus("Workspace saved once and published for every authorized app.", "ready");
  } catch (error) { setStatus(message(error), "error"); }
}

async function prepareCoderLog(log: OperationsLogV1) {
  const principal = requirePrincipal();
  if (!window.confirm(`Prepare a Rotator coder job for ${log.sourceAppId}? This stores a bounded evidence draft only; it does not change code or deploy.`)) return;
  setStatus(`Preparing a scoped coder draft for ${log.sourceAppId}…`, "working");
  const prompt = `Investigate this ${log.level} operational record from ${log.sourceAppId}. Determine the likely root cause, propose the smallest safe fix, and identify the tests required. Do not deploy or change production.`;
  try {
    const result = await controller.prepareCoderDraft(principal.tenantIds[0]!, log.sourceAppId, prompt, [log.id], `coder-draft-${log.id}`);
    await loadShell();
    setStatus(result.job.state === "queued" ? "Coder job queued through the Rotator contract." : "Coder evidence saved as a draft; no worker or code mutation occurred.", result.job.state === "queued" ? "ready" : "working");
  } catch (error) { setStatus(message(error), "error"); }
}

async function prepareCoderPrompt(appId: string, prompt: string) {
  const principal = requirePrincipal();
  setStatus(`Preparing a scoped Coder job for ${appId}…`, "working");
  try {
    const result = await controller.prepareCoderDraft(principal.tenantIds[0]!, appId, prompt, [], `coder-chat-${crypto.randomUUID()}`);
    await loadShell();
    setStatus(result.job.state === "queued" ? "Coder accepted the job." : "Coder saved the job as a draft; the Rotator worker is not connected yet.", result.job.state === "queued" ? "ready" : "working");
  } catch (error) { setStatus(message(error), "error"); }
}

async function issueOverlayOutput(appId: string, widgetId: string, personal: boolean) {
  const principal = requirePrincipal();
  if (!currentPrincipal?.scopes.includes("overlay:outputs:write")) return setStatus("Only the ecosystem owner can issue browser-source URLs.", "error");
  setStatus(`Issuing a ${personal ? "personal" : "public"} browser-source URL…`, "working");
  try {
    const issued = await controller.issueOverlayOutput(principal.tenantIds[0]!, appId, widgetId, personal ? principal.actorId : undefined);
    const browserSourceUrl = issued.browserSourceUrl;
    dialogTitle.textContent = "Overlay browser-source URL";
    dialogBody.replaceChildren(textBlock(browserSourceUrl || "The URL was issued but was not returned by the server."));
    if (browserSourceUrl) {
      const copy = document.createElement("button"); copy.textContent = "Copy URL"; copy.addEventListener("click", () => void navigator.clipboard.writeText(browserSourceUrl)); dialogBody.append(copy);
    }
    if (!dialog.open) dialog.showModal();
    await loadShell();
    setStatus("Browser-source URL issued by SpaceMountain. Copy it now; the secret token is shown only once.", "ready");
  } catch (error) { setStatus(message(error), "error"); }
}

async function revokeOverlayOutput(grantId: string) {
  const principal = requirePrincipal();
  if (!grantId || !window.confirm("Revoke this browser-source URL? Existing OBS/browser sources will stop loading it.")) return;
  try { await controller.revokeOverlayOutput(principal.tenantIds[0]!, grantId); await loadShell(); setStatus("Browser-source URL revoked.", "ready"); }
  catch (error) { setStatus(message(error), "error"); }
}

async function logout() {
  await fetch("/sandbox/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  shellUi?.destroy();
  shellUi = undefined;
  currentPrincipal = undefined;
  registryFingerprint = "";
  registeredAppIds.clear();
  developerDialog.close();
  showAuth("Signed out of the isolated sandbox.");
}

async function watchRegistry() {
  if (!currentPrincipal || loading || document.visibilityState !== "visible") return;
  try {
    const apps = await spmt.listApps();
    const next = registrySignature(apps);
    if (next !== registryFingerprint) {
      setStatus("SPMT published a registry change · refreshing Shipyard…", "working");
      await loadShell();
    }
  } catch (error) {
    setStatus(`Registry watch degraded · ${message(error)}`, "error");
  }
}

function showAuth(detail: string) {
  shellView.hidden = true;
  authView.hidden = false;
  refreshButton.hidden = true;
  logoutButton.hidden = true;
  openDeveloperButton.hidden = true;
  setStatus(detail, detail.toLowerCase().includes("error") ? "error" : "working");
}

function parsePrincipal(value: Record<string, unknown>): Principal {
  const actorId = typeof value.actorId === "string" ? value.actorId : "";
  const tenantIds = Array.isArray(value.tenantIds) ? value.tenantIds.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
  const scopes = Array.isArray(value.scopes) ? value.scopes.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
  if (!actorId || !tenantIds.length) throw new Error("The SPMT session has no user or tenant.");
  return { actorId, tenantIds, scopes };
}

function authInput(form: HTMLFormElement, includeDisplayName: boolean) {
  const data = new FormData(form);
  const username = String(data.get("username") ?? "").trim();
  const password = String(data.get("password") ?? "");
  const displayName = String(data.get("displayName") ?? "").trim();
  if (!username || password.length < 12) throw new Error("Use a username and a sandbox-only password of at least 12 characters.");
  return { username, password, ...(includeDisplayName ? { displayName } : {}) };
}

function requirePrincipal() {
  if (!currentPrincipal) throw new Error("Sign in to the sandbox first.");
  return currentPrincipal;
}

function registrySignature(apps: Array<{ appId?: unknown; name?: unknown; version?: unknown }>) {
  return JSON.stringify(apps.map((app) => [String(app.appId ?? ""), String(app.name ?? ""), String(app.version ?? "")]).sort((left, right) => left[0]!.localeCompare(right[0]!)));
}

function messageCard(value: Record<string, unknown>) {
  const article = document.createElement("article");
  const who = document.createElement("strong");
  who.textContent = typeof value.senderId === "string" ? value.senderId : "SPMT";
  const body = document.createElement("p");
  body.textContent = typeof value.text === "string" ? value.text : "";
  article.append(who, body);
  return article;
}

function textBlock(value: string) { const node = document.createElement("p"); node.textContent = value; return node; }
function apiMessage(value: unknown, fallback: string) { return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).message === "string" ? String((value as Record<string, unknown>).message) : fallback; }
function setStatus(value: string, kind: "ready" | "working" | "error") { status.textContent = value; status.dataset.kind = kind; }
function message(value: unknown) {
  if (value instanceof SpmtApiError) {
    try {
      const payload = JSON.parse(value.responseBody) as Record<string, unknown>;
      if (typeof payload.message === "string" && payload.message) return payload.message;
    } catch { /* Keep the bounded SDK fallback when the response is not JSON. */ }
  }
  return value instanceof Error ? value.message : String(value ?? "Unknown error");
}
function escapeText(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function element<T extends HTMLElement>(id: string) { const node = document.getElementById(id); if (!node) throw new Error(`Missing #${id}`); return node as T; }
