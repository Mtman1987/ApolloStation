import { SpmtApiError, SpmtClient } from "@spmt/sdk";
import type { OperationsLogV1 } from "@spmt/contracts";
import { SpaceMountainShellController, buildAppFrameTarget, type SpaceMountainAppCardV1 } from "@spmt/spacemountain";
import { SpaceMountainShellUi } from "@spmt/spacemountain/ui";

type Principal = { actorId: string; tenantIds: string[] };

const authView = element<HTMLElement>("auth-view");
const shellView = element<HTMLElement>("shell-view");
const shellRoot = element<HTMLElement>("spacemountain-root");
const status = element<HTMLElement>("sandbox-status");
const refreshButton = element<HTMLButtonElement>("refresh-shell");
const logoutButton = element<HTMLButtonElement>("logout");
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

loginForm.addEventListener("submit", (event) => void submitLogin(event));
registerForm.addEventListener("submit", (event) => void submitRegistration(event));
refreshButton.addEventListener("click", () => void loadShell().catch((error) => setStatus(message(error), "error")));
logoutButton.addEventListener("click", () => void logout());
window.setInterval(() => void watchRegistry(), 20_000);

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
    currentPrincipal = principal;
    authView.hidden = true;
    shellView.hidden = false;
    refreshButton.hidden = false;
    logoutButton.hidden = false;
    if (shellUi) shellUi.update(snapshot);
    else shellUi = new SpaceMountainShellUi({
      root: shellRoot,
      snapshot,
      onInstallApp: (app) => void installApp(app),
      onLaunchApp: (app) => launchApp(app),
      onOpenConversation: (conversation) => void openConversation(conversation),
      onSearchCommlink: (query) => void searchCommlink(query),
      onMarkNotificationRead: (notification) => void markNotificationRead(notification),
      onUnlinkProvider: (link) => void unlinkProvider(link),
      onSaveWorkspace: (expectedRevision, patch) => void saveWorkspace(expectedRevision, patch),
      onPrepareCoderLog: (log) => void prepareCoderLog(log),
    }).mount();
    const degraded = Object.entries(snapshot.sources).filter(([, source]) => source.state !== "ready").map(([name]) => name);
    setStatus(degraded.length ? `Sandbox open · degraded: ${degraded.join(", ")}` : `Sandbox open · ${snapshot.apps.length} registry app${snapshot.apps.length === 1 ? "" : "s"} visible`, degraded.length ? "working" : "ready");
  } finally {
    loading = false;
  }
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
  setStatus("Saving the canonical SPMT workspace…", "working");
  try {
    await controller.saveWorkspace(principal.tenantIds[0]!, expectedRevision, patch);
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

async function logout() {
  await fetch("/sandbox/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  shellUi?.destroy();
  shellUi = undefined;
  currentPrincipal = undefined;
  registryFingerprint = "";
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
  setStatus(detail, detail.toLowerCase().includes("error") ? "error" : "working");
}

function parsePrincipal(value: Record<string, unknown>): Principal {
  const actorId = typeof value.actorId === "string" ? value.actorId : "";
  const tenantIds = Array.isArray(value.tenantIds) ? value.tenantIds.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
  if (!actorId || !tenantIds.length) throw new Error("The SPMT session has no user or tenant.");
  return { actorId, tenantIds };
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
function setStatus(value: string, kind: "ready" | "working" | "error") { status.textContent = value; status.dataset.kind = kind; }
function message(value: unknown) { return value instanceof Error ? value.message : String(value ?? "Unknown error"); }
function element<T extends HTMLElement>(id: string) { const node = document.getElementById(id); if (!node) throw new Error(`Missing #${id}`); return node as T; }
