import type { SpaceMountainShellSnapshotV1 } from "./index.js";
import { OVERLAY_SOURCE_KINDS, createOverlayScene, createOverlaySource, normalizeOverlayScenes, saveOverlayScene, sourceLabel, type OverlaySceneSourceV1, type OverlaySceneV1, type OverlaySourceKindV1 } from "./overlay-scenes.js";

const NEBULA_GAMES = [
  ["tag","Tag"],["quackverse","Quackverse"],["bingo","Bingo"],["chaosmode","Chaos Mode"],["chatgarden","Chat Garden"],["chatwars","Chat Wars"],["chickenroyale","Chicken Royale"],["colorsymphony","Color Symphony"],["colorwars","Color Wars"],["dancingparade","Dancing Parade"],["emojirain","Emoji Rain"],["emojitower","Emoji Tower"],["memorylane","Memory Lane"],["petrace","Pet Race"],["phraseguess","Phrase Guess"],["pixelbattle","Pixel Battle"],["rhythmpulse","Rhythm Pulse"],["treasurehunt","Treasure Hunt"],["wordchain","Word Chain"],["wordstorm","Word Storm"],
] as const;

function overlayIconUrl(snapshot: SpaceMountainShellSnapshotV1) {
  const workspace = record(snapshot.workspace);
  const appearance = record(workspace?.appearance);
  const raw = text(appearance?.theme);
  const theme = ["solar-flare", "nebula-purple", "oceanic-blue", "aurora-green"].includes(raw) ? raw : "solar-flare";
  return `/assets/product/app-icons/${theme}/overlay-bay.png`;
}

export class OverlayBayParityController {
  private snapshot: SpaceMountainShellSnapshotV1;
  private scenes: OverlaySceneV1[] = [];
  private activeSceneId = "";
  private selectedSourceId = "";
  private output: "public" | "personal" = "public";

  constructor(private readonly root: HTMLElement, snapshot: SpaceMountainShellSnapshotV1) {
    this.snapshot = snapshot;
    this.loadSnapshot();
  }

  update(snapshot: SpaceMountainShellSnapshotV1) {
    this.snapshot = snapshot;
    this.loadSnapshot();
    this.mount();
  }

  mount() {
    const bay = this.root.querySelector<HTMLElement>("[data-overlay-bay]");
    if (!bay) return;
    if (bay.dataset.overlayParity === "1" && bay.dataset.sceneRevision === String(this.snapshot.workspace?.revision ?? "")) return;
    bay.dataset.overlayParity = "1";
    bay.dataset.sceneRevision = String(this.snapshot.workspace?.revision ?? "");
    bay.classList.add("spmt-overlay-bay-parity");
    this.render(bay);
  }

  private loadSnapshot() {
    try { this.scenes = normalizeOverlayScenes(this.snapshot.workspace?.overlayScenes); }
    catch { this.scenes = []; }
    const field = this.output === "public" ? "activePublicOverlaySceneId" : "activePersonalOverlaySceneId";
    const named = typeof this.snapshot.workspace?.[field] === "string" ? String(this.snapshot.workspace[field]) : "";
    const legacy = typeof this.snapshot.workspace?.activeOverlaySceneId === "string" ? this.snapshot.workspace.activeOverlaySceneId : "";
    const requested = named || legacy;
    if (requested && this.scenes.some((scene) => scene.id === requested)) this.activeSceneId = requested;
    else if (!this.scenes.some((scene) => scene.id === this.activeSceneId)) this.activeSceneId = this.scenes[0]?.id ?? "";
    if (!this.activeSceneId) this.selectedSourceId = "";
  }

  private activeScene() { return this.scenes.find((scene) => scene.id === this.activeSceneId); }
  private selectedSource() { return this.activeScene()?.sources.find((source) => source.id === this.selectedSourceId); }

  private render(bay: HTMLElement) {
    const scene = this.activeScene();
    const owner = hasScope(this.snapshot.session, "overlay:outputs:write");
    const headActions = [`<button type="button" data-ob-new>New scene</button>`];
    if (scene) headActions.push(`<button type="button" data-ob-duplicate>Duplicate</button>`, `<button type="button" data-ob-delete>Delete</button>`);
    const tabs = this.scenes.length ? this.scenes.map((item) => `<button type="button" data-ob-scene="${esc(item.id)}" class="${item.id === this.activeSceneId ? "active" : ""}">${esc(item.name)}</button>`).join("") : `<span>No saved scenes yet.</span>`;
    const body = scene ? this.editor(scene, owner) : `<div class="ob-first"><h3>Create your first overlay scene</h3><p>Combine app widgets, a Nebula Game Mix, URLs, images, text, alerts, camera, screen, Xbox, links, ticker, and weather in one final browser source.</p><button type="button" data-ob-new class="primary">Create scene</button></div>`;
    bay.innerHTML = `<style>${OVERLAY_EDITOR_CSS}</style><header class="ob-head"><div style="display:flex;align-items:center;gap:14px"><img src="${overlayIconUrl(this.snapshot)}" alt="" style="width:72px;height:72px;object-fit:contain;filter:drop-shadow(0 0 16px var(--accent2))"><div><span>OVERLAY BAY</span><h2>Canonical ecosystem overlay editor</h2><p>Public is the OBS program. Personal is the private workspace HUD. They can use the same scene or different scenes.</p></div></div><div class="ob-head-actions"><button type="button" data-ob-output="public" class="${this.output === "public" ? "active" : ""}">Public</button><button type="button" data-ob-output="personal" class="${this.output === "personal" ? "active" : ""}">Personal</button>${headActions.join("")}</div></header><div class="ob-output-note">Editing <strong>${this.output === "public" ? "Public · OBS/browser source" : "Personal · signed-in workspace"}</strong></div><div class="ob-tabs">${tabs}</div>${body}${this.outputs(owner)}`;
    this.bind(bay);
  }

  private editor(scene: OverlaySceneV1, owner: boolean) {
    const paletteKinds = OVERLAY_SOURCE_KINDS.filter((kind) => kind !== "widget").map((kind) => `<button type="button" data-ob-add-kind="${kind}">${esc(sourceLabel(kind))}</button>`).join("");
    const widgets = (this.snapshot.overlayWidgets ?? []).map((item) => {
      const manifest = record(item.manifest); const appId = text(manifest?.appId); const widgetId = text(manifest?.widgetId); const title = text(manifest?.title) || widgetId;
      if (!appId || !widgetId) return "";
      return `<button type="button" data-ob-add-widget="${esc(appId)}|${esc(widgetId)}" data-renderer="${esc(text(manifest?.rendererUrl))}">${esc(title)}<small>${esc(appId)}</small></button>`;
    }).join("") || `<small>Installed apps have not registered widgets yet.</small>`;
    const sources = scene.sources.filter((source) => source.visible).map((source) => this.sourceCard(source)).join("") || `<div class="ob-empty">Add a source from the left. Nebula Arcade can contain any combination of all 20 games inside one source.</div>`;
    const issueButtons = owner ? `<button type="button" data-ob-copy-output="public">Copy Public URL</button><button type="button" data-ob-copy-output="personal">Copy Personal URL</button>` : "";
    return `<div class="ob-shell"><aside class="ob-palette"><h3>Add source</h3><div class="ob-source-kinds">${paletteKinds}</div><h3>App widgets</h3><div class="ob-widgets">${widgets}</div></aside><main class="ob-stage-wrap"><div class="ob-stage-head"><input data-ob-scene-name maxlength="100" value="${esc(scene.name)}" aria-label="Scene name"><span>${scene.canvasWidth} × ${scene.canvasHeight}</span><button type="button" data-ob-preview>Preview in rooms</button><button type="button" data-ob-save class="primary">Save</button>${issueButtons}</div><div class="ob-stage" data-ob-stage>${sources}</div></main><aside class="ob-inspector">${this.inspector(scene)}</aside></div>`;
  }

  private sourceCard(source: OverlaySceneSourceV1) {
    return `<article class="ob-source ${source.id === this.selectedSourceId ? "selected" : ""} ${source.locked ? "locked" : ""}" data-ob-source="${esc(source.id)}" style="left:${source.x}%;top:${source.y}%;width:${source.width}%;height:${source.height}%;opacity:${source.opacity};z-index:${source.zIndex}"><header><b>${esc(source.name)}</b><small>${esc(sourceLabel(source.kind))}</small></header><div>${this.preview(source)}</div><i data-ob-resize title="Resize"></i></article>`;
  }

  private preview(source: OverlaySceneSourceV1) {
    const config = source.config;
    if (source.kind === "image" && typeof config.url === "string") return `<img src="${esc(config.url)}" alt="">`;
    if (source.kind === "web" && typeof config.url === "string") return `<span>${esc(config.url)}</span>`;
    if (["text","alert","ticker","links","weather"].includes(source.kind)) return `<strong>${esc(String(config.text ?? source.name))}</strong>`;
    if (source.kind === "nebula") { const ids = strings(config.gameIds); return `<strong>${ids.length} game${ids.length === 1 ? "" : "s"}</strong><span>${esc(String(config.mode ?? "simultaneous"))}</span>`; }
    if (source.kind === "widget") return `<strong>${esc(String(config.widgetId ?? "App widget"))}</strong>`;
    return `<strong>${esc(source.name)}</strong>`;
  }

  private inspector(scene: OverlaySceneV1) {
    const source = this.selectedSource();
    if (!source) return `<h3>Scene</h3><p>Select a source on the canvas to edit it.</p><label>Canvas width<input data-ob-canvas="width" type="number" min="320" max="7680" value="${scene.canvasWidth}"></label><label>Canvas height<input data-ob-canvas="height" type="number" min="180" max="4320" value="${scene.canvasHeight}"></label>`;
    return `<h3>${esc(source.name)}</h3><label>Name<input data-ob-field="name" maxlength="100" value="${esc(source.name)}"></label><div class="ob-grid">${numberField("x","X %",source.x,0,100)}${numberField("y","Y %",source.y,0,100)}${numberField("width","Width %",source.width,1,100)}${numberField("height","Height %",source.height,1,100)}</div><label>Opacity <output>${Math.round(source.opacity * 100)}%</output><input data-ob-field="opacity" type="range" min="0" max="1" step=".01" value="${source.opacity}"></label><label>Parallax <output>${Math.round(source.parallax)}%</output><input data-ob-field="parallax" type="range" min="0" max="100" step="1" value="${source.parallax}"></label><div class="ob-checks"><label><input data-ob-field="visible" type="checkbox" ${source.visible ? "checked" : ""}>Visible</label><label><input data-ob-field="locked" type="checkbox" ${source.locked ? "checked" : ""}>Locked</label><label><input data-ob-field="interactive" type="checkbox" ${source.interactive ? "checked" : ""}>Interactive</label></div>${this.configEditor(source)}<div class="ob-source-actions"><button type="button" data-ob-back>Send back</button><button type="button" data-ob-front>Bring front</button><button type="button" data-ob-copy>Duplicate</button><button type="button" data-ob-remove>Delete</button></div>`;
  }

  private configEditor(source: OverlaySceneSourceV1) {
    const config = source.config;
    if (source.kind === "web" || source.kind === "image") return `<label>${source.kind === "image" ? "Image" : "Web / overlay"} URL<input data-ob-config="url" type="url" value="${esc(String(config.url ?? ""))}" placeholder="https://…"></label>`;
    if (["text","alert","ticker","links","weather"].includes(source.kind)) return `<label>Content<textarea data-ob-config="text" rows="4">${esc(String(config.text ?? ""))}</textarea></label>${source.kind === "alert" ? `<button type="button" data-ob-test-alert>Test alert</button>` : ""}`;
    if (source.kind === "nebula") return this.nebulaEditor(source);
    if (source.kind === "widget") return `<p>Renderer: ${esc(String(config.appId ?? ""))} / ${esc(String(config.widgetId ?? ""))}</p>`;
    return `<p>This source is capability-backed. Capture or bridge permission is granted at runtime; Overlay Bay owns its position, visibility, interaction, opacity, parallax, and layering.</p>`;
  }

  private nebulaEditor(source: OverlaySceneSourceV1) {
    const config = source.config; const selected = new Set(strings(config.gameIds)); const styles = record(config.gameStyles) ?? {};
    const games = NEBULA_GAMES.map(([id, name]) => `<label><input type="checkbox" data-ob-game="${id}" ${selected.has(id) ? "checked" : ""}><span>${esc(name)}</span><select data-ob-game-style="${id}"><option value="full">Full</option><option value="compact" ${styles[id] === "compact" ? "selected" : ""}>Compact</option><option value="minimal" ${styles[id] === "minimal" ? "selected" : ""}>Minimal</option></select></label>`).join("");
    const mode = String(config.mode ?? "simultaneous");
    return `<label><input data-ob-config="activityBox" type="checkbox" ${config.activityBox===true?"checked":""}> Show Arcade activity box</label><p>Shows joined players chatting in the last 5 minutes. Appears for 30 seconds after spmt. Include it in your personal or public output.</p><label>Display mode<select data-ob-config="mode"><option value="simultaneous" ${mode === "simultaneous" ? "selected" : ""}>Show together</option><option value="activity" ${mode === "activity" ? "selected" : ""}>Follow activity</option><option value="rotate" ${mode === "rotate" ? "selected" : ""}>Rotate</option><option value="manual" ${mode === "manual" ? "selected" : ""}>Manual focus</option></select></label><label>Rotation seconds<input data-ob-config="rotationSeconds" type="number" min="5" max="300" value="${Number(config.rotationSeconds ?? 20)}"></label><div class="ob-games">${games}</div>`;
  }

  private outputs(owner: boolean) {
    const canonical = this.snapshot.tenantOutputs;
    const named = canonical ? `<article><div><b>Public · canonical OBS program</b><small>${esc(canonical.public.url)}</small></div><button type="button" data-ob-copy-output="public">Copy</button></article><article><div><b>Personal · signed-in workspace HUD</b><small>${esc(canonical.personal.url)}</small></div><button type="button" data-ob-copy-output="personal">Copy</button></article>` : `<p>Canonical tenant output URLs are unavailable.</p>`;
    const items = (this.snapshot.overlayOutputs ?? []).map((item) => {
      const revoked = Boolean(text(item.revokedAt)); const status = revoked ? "revoked" : `expires ${esc(text(item.expiresAt) || "—")}`;
      const button = owner && !revoked ? `<button type="button" data-ob-revoke="${esc(text(item.grantId))}">Revoke</button>` : "";
      return `<article><div><b>${esc(text(item.appId) || "ecosystem")} · ${esc(text(item.widgetId) || "widget")}</b><small>${status}</small></div>${button}</article>`;
    }).join("");
    return `<section class="ob-outputs"><h3>Canonical tenant outputs</h3>${named}<details><summary>Temporary app/widget grants</summary>${items || `<p>No temporary grants.</p>`}</details></section>`;
  }

  private bind(bay: HTMLElement) {
    bay.querySelectorAll<HTMLElement>("[data-ob-new]").forEach((node) => node.onclick = () => this.newScene(bay));
    bay.querySelectorAll<HTMLElement>("[data-ob-output]").forEach((node) => node.onclick = () => { this.output = node.dataset.obOutput === "personal" ? "personal" : "public"; this.loadSnapshot(); this.render(bay); });
    bay.querySelectorAll<HTMLElement>("[data-ob-scene]").forEach((node) => node.onclick = () => { this.activeSceneId = node.dataset.obScene ?? ""; this.selectedSourceId = ""; this.render(bay); });
    bay.querySelector<HTMLElement>("[data-ob-duplicate]")?.addEventListener("click", () => this.duplicateScene(bay));
    bay.querySelector<HTMLElement>("[data-ob-delete]")?.addEventListener("click", () => void this.deleteScene(bay));
    bay.querySelector<HTMLElement>("[data-ob-save]")?.addEventListener("click", () => void this.persist(true).then(() => this.render(bay)).catch(showError));
    bay.querySelector<HTMLElement>("[data-ob-preview]")?.addEventListener("click", () => void this.previewScene().catch(showError));
    bay.querySelectorAll<HTMLElement>("[data-ob-copy-output]").forEach((node) => node.onclick = () => void this.copyOutput(node.dataset.obCopyOutput === "personal" ? "personal" : "public"));
    bay.querySelectorAll<HTMLElement>("[data-ob-revoke]").forEach((node) => node.onclick = () => void this.revoke(node.dataset.obRevoke ?? "", bay));
    bay.querySelectorAll<HTMLElement>("[data-ob-add-kind]").forEach((node) => node.onclick = () => this.addKind(node.dataset.obAddKind as OverlaySourceKindV1, bay));
    bay.querySelectorAll<HTMLElement>("[data-ob-add-widget]").forEach((node) => node.onclick = () => this.addWidget(node, bay));
    bay.querySelectorAll<HTMLElement>("[data-ob-source]").forEach((node) => { node.onclick = (event) => { if ((event.target as HTMLElement).hasAttribute("data-ob-resize")) return; this.selectedSourceId = node.dataset.obSource ?? ""; this.render(bay); }; this.drag(node, bay); });
    const name = bay.querySelector<HTMLInputElement>("[data-ob-scene-name]"); if (name) name.onchange = () => this.updateScene({ name: name.value });
    bay.querySelectorAll<HTMLInputElement>("[data-ob-canvas]").forEach((node) => node.onchange = () => this.updateScene(node.dataset.obCanvas === "width" ? { canvasWidth: Number(node.value) } : { canvasHeight: Number(node.value) }));
    bay.querySelectorAll<HTMLInputElement>("[data-ob-field]").forEach((node) => node.oninput = () => { const key = node.dataset.obField ?? ""; const value: unknown = node.type === "checkbox" ? node.checked : key === "name" ? node.value : Number(node.value); this.updateSelected({ [key]: value } as Partial<OverlaySceneSourceV1>); });
    bay.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-ob-config]").forEach((node) => node.onchange = () => { const source = this.selectedSource(); if (!source) return; const key = node.dataset.obConfig ?? ""; const value: unknown = node instanceof HTMLInputElement && node.type === "checkbox" ? node.checked : node instanceof HTMLInputElement && node.type === "number" ? Number(node.value) : node.value; this.updateSelected({ config: { ...source.config, [key]: value } }); });
    bay.querySelectorAll<HTMLInputElement>("[data-ob-game]").forEach((node) => node.onchange = () => this.updateNebulaGames(bay));
    bay.querySelectorAll<HTMLSelectElement>("[data-ob-game-style]").forEach((node) => node.onchange = () => this.updateNebulaGames(bay));
    bay.querySelector<HTMLElement>("[data-ob-front]")?.addEventListener("click", () => this.reorder(1, bay));
    bay.querySelector<HTMLElement>("[data-ob-back]")?.addEventListener("click", () => this.reorder(-1, bay));
    bay.querySelector<HTMLElement>("[data-ob-copy]")?.addEventListener("click", () => this.copySource(bay));
    bay.querySelector<HTMLElement>("[data-ob-remove]")?.addEventListener("click", () => this.removeSource(bay));
    bay.querySelector<HTMLElement>("[data-ob-test-alert]")?.addEventListener("click", () => void this.testAlert(bay).catch(showError));
  }

  private newScene(bay: HTMLElement) { const name = window.prompt("Scene name", "Stream Overlay")?.trim(); if (!name) return; const scene = createOverlayScene(name); this.scenes.push(scene); this.activeSceneId = scene.id; this.selectedSourceId = ""; this.render(bay); }
  private duplicateScene(bay: HTMLElement) { const scene = this.activeScene(); if (!scene) return; const now = new Date().toISOString(); const copy: OverlaySceneV1 = { ...structuredClone(scene), id: `scene-${crypto.randomUUID()}`, name: `${scene.name} Copy`, createdAt: now, updatedAt: now, sources: scene.sources.map((source) => ({ ...source, id: `source-${crypto.randomUUID()}` })) }; this.scenes.push(copy); this.activeSceneId = copy.id; this.selectedSourceId = ""; this.render(bay); }
  private async deleteScene(bay: HTMLElement) { const scene = this.activeScene(); if (!scene || !window.confirm(`Delete “${scene.name}”?`)) return; this.scenes = this.scenes.filter((item) => item.id !== scene.id); this.activeSceneId = this.scenes[0]?.id ?? ""; this.selectedSourceId = ""; await this.persist(false); this.render(bay); }
  private addKind(kind: OverlaySourceKindV1, bay: HTMLElement) { const source = createOverlaySource(kind, kind === "nebula" ? "Nebula Arcade Game Mix" : sourceLabel(kind)); if (kind === "nebula") source.config = { mixId: `mix-${crypto.randomUUID()}`, gameIds: ["tag"], mode: "simultaneous", rotationSeconds: 20, gameStyles: { tag: "full" } }; this.addSource(source, bay); }
  private addWidget(node: HTMLElement, bay: HTMLElement) { const [appId = "", widgetId = ""] = String(node.dataset.obAddWidget ?? "").split("|"); const source = createOverlaySource("widget", node.textContent?.trim().slice(0, 100) || widgetId); source.config = { appId, widgetId, rendererUrl: node.dataset.renderer ?? "" }; this.addSource(source, bay); }
  private addSource(source: OverlaySceneSourceV1, bay: HTMLElement) { const scene = this.activeScene(); if (!scene) return; source.zIndex = scene.sources.length; this.updateScene({ sources: [...scene.sources, source] }); this.selectedSourceId = source.id; this.render(bay); }
  private copySource(bay: HTMLElement) { const scene = this.activeScene(); const source = this.selectedSource(); if (!scene || !source) return; const copy = { ...structuredClone(source), id: `source-${crypto.randomUUID()}`, name: `${source.name} Copy`, zIndex: scene.sources.length }; this.addSource(copy, bay); }
  private removeSource(bay: HTMLElement) { const scene = this.activeScene(); const source = this.selectedSource(); if (!scene || !source) return; this.updateScene({ sources: scene.sources.filter((item) => item.id !== source.id).map((item, zIndex) => ({ ...item, zIndex })) }); this.selectedSourceId = ""; this.render(bay); }
  private reorder(direction: number, bay: HTMLElement) { const scene = this.activeScene(); const source = this.selectedSource(); if (!scene || !source) return; const ordered = [...scene.sources].sort((a, b) => a.zIndex - b.zIndex); const index = ordered.findIndex((item) => item.id === source.id); const target = clamp(index + direction, 0, ordered.length - 1); if (index < 0 || target === index) return; const [moved] = ordered.splice(index, 1); if (!moved) return; ordered.splice(target, 0, moved); this.updateScene({ sources: ordered.map((item, zIndex) => ({ ...item, zIndex })) }); this.render(bay); }
  private updateScene(patch: Partial<Pick<OverlaySceneV1, "name" | "canvasWidth" | "canvasHeight" | "sources">>) { const scene = this.activeScene(); if (!scene) return; const updated = saveOverlayScene(scene, patch); this.scenes = this.scenes.map((item) => item.id === scene.id ? updated : item); }
  private updateSelected(patch: Partial<OverlaySceneSourceV1>) { const scene = this.activeScene(); const source = this.selectedSource(); if (!scene || !source) return; this.updateScene({ sources: scene.sources.map((item) => item.id === source.id ? { ...item, ...patch } : item) }); }
  private updateNebulaGames(bay: HTMLElement) { const source = this.selectedSource(); if (!source || source.kind !== "nebula") return; const gameIds = [...bay.querySelectorAll<HTMLInputElement>("[data-ob-game]:checked")].map((node) => node.dataset.obGame ?? "").filter(Boolean); const gameStyles = Object.fromEntries([...bay.querySelectorAll<HTMLSelectElement>("[data-ob-game-style]")].map((node) => [node.dataset.obGameStyle ?? "", node.value]).filter(([key]) => Boolean(key))); this.updateSelected({ config: { ...source.config, gameIds, gameStyles } }); this.render(bay); }

  private drag(node: HTMLElement, bay: HTMLElement) {
    node.onpointerdown = (event) => {
      const source = this.activeScene()?.sources.find((item) => item.id === node.dataset.obSource); const stage = bay.querySelector<HTMLElement>("[data-ob-stage]"); if (!source || source.locked || !stage) return;
      const resize = (event.target as HTMLElement).hasAttribute("data-ob-resize"); event.preventDefault(); node.setPointerCapture(event.pointerId);
      const rect = stage.getBoundingClientRect(); const startX = event.clientX; const startY = event.clientY; const original = { x: source.x, y: source.y, width: source.width, height: source.height };
      node.onpointermove = (move) => { const dx = (move.clientX - startX) / rect.width * 100; const dy = (move.clientY - startY) / rect.height * 100; if (resize) this.updateSelected({ width: clamp(original.width + dx, 1, 100 - original.x), height: clamp(original.height + dy, 1, 100 - original.y) }); else this.updateSelected({ x: clamp(original.x + dx, 0, 100 - original.width), y: clamp(original.y + dy, 0, 100 - original.height) }); const current = this.selectedSource(); if (current) { node.style.left = `${current.x}%`; node.style.top = `${current.y}%`; node.style.width = `${current.width}%`; node.style.height = `${current.height}%`; } };
      node.onpointerup = () => { node.onpointermove = null; node.onpointerup = null; this.render(bay); };
    };
  }

  private async testAlert(bay: HTMLElement) { const stage = bay.querySelector<HTMLElement>("[data-ob-stage]"), source = this.selectedSource(); if (!stage || !source) return; const test = document.createElement("div"); test.className = "ob-alert-test"; test.textContent = String(source.config.text ?? "Test alert"); stage.append(test); window.setTimeout(() => test.remove(), 2200); await this.publishSimulation("Overlay Bay alert preview", test.textContent, { sourceId: source.id, sourceKind: source.kind }); }

  private async previewScene() {
    const scene = this.activeScene(); if (!scene) return;
    await this.publishSimulation(`Overlay Bay ${this.output} scene preview`, `${scene.name} · ${scene.sources.filter((source) => source.visible).length} visible sources`, { sceneId: scene.id, output: this.output, canvas: { width: scene.canvasWidth, height: scene.canvasHeight }, sources: scene.sources.map((source) => ({ id: source.id, name: source.name, kind: source.kind, visible: source.visible, x: source.x, y: source.y, width: source.width, height: source.height, zIndex: source.zIndex, ...(source.kind === "nebula" ? { gameIds: strings(source.config.gameIds) } : {}) })) });
  }

  private async publishSimulation(title: string, body: string, data: Record<string, unknown>) {
    const sceneId = this.activeScene()?.id ?? "overlay", occurredAt = new Date().toISOString();
    const response = await fetch("/v1/simulation-rooms/events", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-spmt-tenant": this.snapshot.tenantId, "idempotency-key": `overlay-preview:${sceneId}:${crypto.randomUUID()}` }, body: JSON.stringify({ schemaVersion: 1, roomId: `overlay:${this.output}:${sceneId}`, lane: "overlay", direction: "preview", title, body: body.slice(0, 8_000), data, occurredAt }) });
    if (!response.ok) throw new Error(`Simulation Room preview failed (${response.status})`);
  }

  private async persist(syncNebula: boolean) {
    const scene = this.activeScene(); const input = this.root.querySelector<HTMLInputElement>("[data-ob-scene-name]"); if (scene && input) this.updateScene({ name: input.value });
    if (syncNebula) await this.syncNebula();
    const revision = numeric(this.snapshot.workspace?.revision); if (!revision) throw new Error("Workspace revision is unavailable");
    const ids = new Set(this.scenes.map((item) => item.id));
    const priorPublic = text(this.snapshot.workspace?.activePublicOverlaySceneId) || text(this.snapshot.workspace?.activeOverlaySceneId);
    const priorPersonal = text(this.snapshot.workspace?.activePersonalOverlaySceneId) || priorPublic;
    const activePublicOverlaySceneId = this.output === "public" ? this.activeSceneId || null : ids.has(priorPublic) ? priorPublic : null;
    const activePersonalOverlaySceneId = this.output === "personal" ? this.activeSceneId || null : ids.has(priorPersonal) ? priorPersonal : activePublicOverlaySceneId;
    const response = await fetch("/v1/workspace/profile", { method: "PATCH", headers: { "content-type": "application/json", "x-spmt-tenant": this.snapshot.tenantId }, body: JSON.stringify({ expectedRevision: revision, patch: { overlayScenes: this.scenes, activeOverlaySceneId: activePublicOverlaySceneId || undefined, activePublicOverlaySceneId, activePersonalOverlaySceneId } }) });
    const body = record(await safeJson(response)); if (!response.ok) throw new Error(String(body?.message ?? `Overlay scene save failed (${response.status})`));
    if (body) this.snapshot.workspace = { ...this.snapshot.workspace, ...body }; else if (this.snapshot.workspace) this.snapshot.workspace.revision = revision + 1;
  }

  private async syncNebula() {
    for (const scene of this.scenes) for (const source of scene.sources.filter((item) => item.kind === "nebula")) {
      const gameIds = strings(source.config.gameIds); if (!gameIds.length) continue;
      const body = { id: String(source.config.mixId ?? source.id), name: source.name, activityBox: source.config.activityBox===true, mode: String(source.config.mode ?? "simultaneous"), rotationSeconds: Number(source.config.rotationSeconds ?? 20), layers: gridLayers(gameIds, record(source.config.gameStyles) ?? {}) };
      const response = await fetch("/v1/nebula/game-mixes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Nebula Game Mix save failed (${response.status})`);
    }
  }

  private async issue(personal: boolean, bay: HTMLElement) {
    try {
      await this.persist(true); const scene = this.activeScene(); if (!scene) return;
      const registration = await fetch("/v1/overlay/scenes/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: this.snapshot.tenantId, sceneId: scene.id }) });
      if (!registration.ok) throw new Error(`Scene registration failed (${registration.status})`);
      const payload: Record<string, unknown> = { appId: "overlay-bay", widgetId: `scene:${scene.id}` }; if (personal) payload.viewerUserId = this.snapshot.userId;
      const issued = await fetch("/v1/overlay/outputs", { method: "POST", headers: { "content-type": "application/json", "x-spmt-tenant": this.snapshot.tenantId }, body: JSON.stringify(payload) });
      const result = record(await safeJson(issued)); if (!issued.ok) throw new Error(String(result?.message ?? `Output issue failed (${issued.status})`));
      const url = text(result?.browserSourceUrl); if (url) window.prompt("Copy this browser-source URL now. It is intentionally shown only once.", url);
      this.render(bay);
    } catch (error) { showError(error); }
  }

  private async copyOutput(output: "public" | "personal") { const url = this.snapshot.tenantOutputs?.[output].url; if (!url) return showError(new Error("Canonical tenant output URL is unavailable")); if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url); else window.prompt(`Copy ${output} overlay URL`, url); }

  private async revoke(grantId: string, bay: HTMLElement) { if (!grantId || !window.confirm("Revoke this browser source?")) return; const response = await fetch(`/v1/overlay/outputs/${encodeURIComponent(grantId)}/revoke`, { method: "POST", headers: { "content-type": "application/json", "x-spmt-tenant": this.snapshot.tenantId }, body: "{}" }); if (!response.ok) showError(new Error(`Revoke failed (${response.status})`)); else { this.snapshot.overlayOutputs = this.snapshot.overlayOutputs.map((item) => text(item.grantId) === grantId ? { ...item, revokedAt: new Date().toISOString() } : item); this.render(bay); } }
}

function gridLayers(gameIds: string[], styles: Record<string, unknown>) { const columns = Math.ceil(Math.sqrt(gameIds.length)); const rows = Math.ceil(gameIds.length / columns); const width = 100 / columns; const height = 100 / rows; return gameIds.map((gameId, index) => ({ gameId, enabled: true, zIndex: index, x: (index % columns) * width, y: Math.floor(index / columns) * height, width, height, opacity: 1, style: ["compact","minimal"].includes(String(styles[gameId])) ? String(styles[gameId]) : "full" })); }
function numberField(key: string, label: string, value: number, min: number, max: number) { return `<label>${label}<input data-ob-field="${key}" type="number" min="${min}" max="${max}" step=".5" value="${value}"></label>`; }
function hasScope(value: unknown, scope: string) { const scopes = record(value)?.scopes; return Array.isArray(scopes) && scopes.includes(scope); }
function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function numeric(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function esc(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }
async function safeJson(response: Response) { try { return await response.json() as unknown; } catch { return undefined; } }
function showError(error: unknown) { window.alert(error instanceof Error ? error.message : "Overlay Bay operation failed"); }

const OVERLAY_EDITOR_CSS = `.spmt-overlay-bay-parity{display:block!important;padding:0!important;overflow:hidden}.ob-head{display:flex;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.12)}.ob-head h2{margin:.15em 0}.ob-head p{margin:0;opacity:.72}.ob-head-actions,.ob-stage-head,.ob-source-actions{display:flex;gap:8px;align-items:center}.ob-tabs{display:flex;gap:6px;padding:10px 14px;overflow:auto;border-bottom:1px solid rgba(255,255,255,.1)}.ob-tabs button.active{outline:1px solid var(--accent)}.ob-shell{display:grid;grid-template-columns:190px minmax(0,1fr) 280px;min-height:620px}.ob-palette,.ob-inspector{padding:14px;overflow:auto;background:rgba(3,8,20,.28)}.ob-palette{border-right:1px solid rgba(255,255,255,.1)}.ob-inspector{border-left:1px solid rgba(255,255,255,.1)}.ob-source-kinds,.ob-widgets{display:grid;gap:6px}.ob-palette button{text-align:left}.ob-palette button small{display:block;opacity:.6}.ob-stage-wrap{min-width:0;padding:12px;display:flex;flex-direction:column;gap:10px}.ob-stage-head input{min-width:160px;flex:1}.ob-stage{position:relative;aspect-ratio:16/9;max-height:70vh;width:100%;overflow:hidden;border:1px solid rgba(100,210,255,.3);border-radius:14px;background:radial-gradient(circle at 30% 20%,rgba(95,60,160,.18),rgba(2,8,20,.72));touch-action:none}.ob-empty{position:absolute;inset:0;display:grid;place-items:center;padding:30px;text-align:center;opacity:.62}.ob-source{position:absolute;border:1px solid rgba(100,220,255,.55);border-radius:10px;background:rgba(7,16,35,.82);box-shadow:0 0 20px rgba(75,80,180,.2);overflow:hidden;user-select:none;touch-action:none}.ob-source.selected{outline:2px solid var(--accent)}.ob-source.locked{border-style:dashed}.ob-source header{display:flex;justify-content:space-between;gap:8px;padding:5px 8px;background:rgba(0,0,0,.25);font-size:11px}.ob-source>div{height:calc(100% - 28px);display:flex;align-items:center;justify-content:center;gap:8px;flex-direction:column;padding:8px;text-align:center}.ob-source img{width:100%;height:100%;object-fit:contain}.ob-source i[data-ob-resize]{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 45%,var(--accent) 46%)}.ob-inspector label{display:grid;gap:5px;margin:9px 0;font-size:12px}.ob-inspector input,.ob-inspector select,.ob-inspector textarea,.ob-stage-head input{width:100%}.ob-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ob-checks{display:grid;grid-template-columns:1fr 1fr;gap:4px}.ob-checks label{display:flex;align-items:center;gap:6px}.ob-checks input{width:auto}.ob-games{display:grid;gap:5px;max-height:280px;overflow:auto}.ob-games label{grid-template-columns:auto 1fr 78px;align-items:center;margin:0;padding:4px;border-bottom:1px solid rgba(255,255,255,.06)}.ob-games input{width:auto}.ob-outputs{padding:14px 18px;border-top:1px solid rgba(255,255,255,.1)}.ob-outputs article{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)}.ob-outputs small{display:block;opacity:.6}.ob-first{padding:30px}.ob-alert-test{position:absolute;inset:25%;z-index:999;display:grid;place-items:center;border-radius:18px;background:rgba(90,20,130,.92);font-size:clamp(20px,4vw,54px);font-weight:900;animation:obtest .25s ease-out}@keyframes obtest{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}@media(max-width:900px){.ob-shell{grid-template-columns:1fr}.ob-palette{border-right:0;border-bottom:1px solid rgba(255,255,255,.1)}.ob-source-kinds,.ob-widgets{grid-template-columns:repeat(2,minmax(0,1fr))}.ob-inspector{border-left:0;border-top:1px solid rgba(255,255,255,.1)}.ob-stage{min-height:360px}.ob-head{flex-direction:column}.ob-stage-head{flex-wrap:wrap}}`;
