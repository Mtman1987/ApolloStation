import { renderAvatarStudioPage as renderBaseAvatarStudioPage } from "./avatar-studio.js";

/**
 * Adds the StreamWeaver avatar source selector to the existing 3D editor.
 * This wrapper intentionally reuses the current renderer and keeps 2D/3D source
 * selection in one page so the browser-source URL remains stable.
 */
export function renderAvatarStudioPage(nonce: string) {
  const html = renderBaseAvatarStudioPage(nonce);
  const panel = `
<aside id="avatarSourcePanel" class="panel">
  <h2>StreamWeaver avatar source</h2>
  <p>Choose the avatar rendered by this studio/browser source. 2D PNG-Tuber images remain supported alongside rigged 3D models.</p>
  <label>Active avatar type<select id="avatarSourceMode"><option value="3d">3D rigged avatar</option><option value="2d">2D PNG-Tuber</option></select></label>
  <label>2D avatar image (PNG/WebP)<input id="pngTuberFile" type="file" accept="image/png,image/webp"></label>
  <label>Optional speaking image (mouth-open PNG/WebP)<input id="pngTuberSpeakingFile" type="file" accept="image/png,image/webp"></label>
  <label>Audio2Face bridge WebSocket URL<input id="audio2FaceUrl" type="url" placeholder="ws://127.0.0.1:8011/avatar"></label>
  <div id="avatarSourcePreview" class="rule" aria-live="polite"><p>No 2D avatar selected. The 3D model remains active.</p></div>
  <div class="cliprow"><button id="connectAudio2Face" type="button">Connect Audio2Face</button><button id="disconnectAudio2Face" type="button">Disconnect</button></div>
  <p id="audio2FaceStatus" role="status">Audio2Face is not connected. Configure a reachable bridge endpoint to enable live facial updates.</p>
  <p>Bridge messages accepted: JSON objects containing a <code>blendshapes</code> object keyed by ARKit names, or <code>jawOpen</code> / <code>mouthOpen</code> numeric values from 0 to 1. This does not start NVIDIA Audio2Face itself; it connects to a bridge you run.</p>
</aside>`;
  const sectionClose = "</section>";
  const sectionAt = html.indexOf(sectionClose);
  const scriptClose = "</script></body></html>";
  const scriptAt = html.lastIndexOf(scriptClose);
  if (sectionAt < 0 || scriptAt < 0) return html;
  const updated = html.slice(0, sectionAt) + panel + html.slice(sectionAt);
  const adjustedScriptAt = updated.lastIndexOf(scriptClose);
  const bridgeScript = `
/* StreamWeaver source selection and Audio2Face bridge adapter. */
const sourceMode = document.querySelector('#avatarSourceMode');
const pngTuberFile = document.querySelector('#pngTuberFile');
const pngTuberSpeakingFile = document.querySelector('#pngTuberSpeakingFile');
const sourcePreview = document.querySelector('#avatarSourcePreview');
const a2fUrl = document.querySelector('#audio2FaceUrl');
const a2fStatus = document.querySelector('#audio2FaceStatus');
const connectA2F = document.querySelector('#connectAudio2Face');
const disconnectA2F = document.querySelector('#disconnectAudio2Face');
let pngIdleUrl = null, pngSpeakingUrl = null, a2fSocket = null, pngMouthOpen = false;
const pngLayer = document.createElement('img');
pngLayer.id = 'pngTuberLayer';
pngLayer.alt = 'Selected 2D PNG-Tuber avatar';
pngLayer.hidden = true;
pngLayer.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(72vw,760px);max-height:86vh;object-fit:contain;pointer-events:none;filter:drop-shadow(0 16px 36px #0009);z-index:1';
room.appendChild(pngLayer);
const style = document.createElement('style');
style.textContent = '#room.avatar-mode-2d canvas{opacity:0}#room.avatar-mode-2d{background:transparent}#pngTuberLayer[hidden]{display:none}#avatarSourcePanel{grid-column:1/-1;max-height:31vh}#avatarSourcePanel p{margin:7px 0}#avatarSourcePanel .cliprow button{flex:1}@media(max-width:800px){#avatarSourcePanel{grid-column:1/-1;max-height:35vh}}';
document.head.appendChild(style);
function setAvatarSourceMode() {
  const is2d = sourceMode.value === '2d';
  room.classList.toggle('avatar-mode-2d', is2d);
  pngLayer.hidden = !is2d || !pngIdleUrl;
  if (is2d) setEditor(true);
  sourcePreview.innerHTML = is2d
    ? '<p><b>2D PNG-Tuber active</b><br>' + (pngIdleUrl ? 'Idle and speaking images are ready.' : 'Upload an idle PNG/WebP image to display the 2D avatar.') + '</p>'
    : '<p><b>3D avatar active</b><br>Use the existing rigged GLB loader and animation editor above.</p>';
}
function loadPngSource(file, speaking) {
  if (!file) return;
  if (speaking) {
    if (pngSpeakingUrl) URL.revokeObjectURL(pngSpeakingUrl);
    pngSpeakingUrl = URL.createObjectURL(file);
  } else {
    if (pngIdleUrl) URL.revokeObjectURL(pngIdleUrl);
    pngIdleUrl = URL.createObjectURL(file);
    pngLayer.src = pngIdleUrl;
  }
  setAvatarSourceMode();
}
sourceMode.addEventListener('change', setAvatarSourceMode);
pngTuberFile.addEventListener('change', e => loadPngSource(e.target.files?.[0], false));
pngTuberSpeakingFile.addEventListener('change', e => loadPngSource(e.target.files?.[0], true));
function applyA2FMessage(payload) {
  if (!payload || typeof payload !== 'object') return;
  const blendshapes = payload.blendshapes && typeof payload.blendshapes === 'object' ? payload.blendshapes : payload;
  const raw = Number(blendshapes.jawOpen ?? blendshapes.mouthOpen ?? blendshapes.JawOpen ?? 0);
  const mouth = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
  pngMouthOpen = mouth > 0.18;
  if (sourceMode.value === '2d' && pngLayer && pngIdleUrl) {
    pngLayer.src = pngMouthOpen && pngSpeakingUrl ? pngSpeakingUrl : pngIdleUrl;
    pngLayer.style.transform = 'translate(-50%,-50%) scale(' + (1 + mouth * 0.025).toFixed(3) + ')';
  }
  if (avatar && blendshapes && typeof blendshapes === 'object') {
    avatar.traverse(node => {
      if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
      for (const [name, value] of Object.entries(blendshapes)) {
        const idx = node.morphTargetDictionary[name];
        if (idx !== undefined && Number.isFinite(Number(value))) node.morphTargetInfluences[idx] = Math.max(0, Math.min(1, Number(value)));
      }
      for (const key of ['jawOpen', 'mouthOpen', 'JawOpen']) {
        const idx = node.morphTargetDictionary[key];
        if (idx !== undefined) node.morphTargetInfluences[idx] = mouth;
      }
    });
  }
}
connectA2F.addEventListener('click', () => {
  const endpoint = a2fUrl.value.trim();
  if (!endpoint || !/^wss?:\\/\\//i.test(endpoint)) {
    a2fStatus.textContent = 'Enter a valid ws:// or wss:// bridge URL first.';
    return;
  }
  try {
    if (a2fSocket) a2fSocket.close();
    a2fSocket = new WebSocket(endpoint);
    a2fSocket.addEventListener('open', () => { a2fStatus.textContent = 'Connected to Audio2Face bridge: ' + endpoint; });
    a2fSocket.addEventListener('message', event => {
      try { applyA2FMessage(JSON.parse(event.data)); }
      catch { a2fStatus.textContent = 'Connected, but received a non-JSON bridge message.'; }
    });
    a2fSocket.addEventListener('error', () => { a2fStatus.textContent = 'Audio2Face bridge connection error. Check endpoint, network access, and bridge logs.'; });
    a2fSocket.addEventListener('close', () => { a2fStatus.textContent = 'Audio2Face bridge disconnected.'; });
    a2fStatus.textContent = 'Connecting to ' + endpoint + '…';
  } catch (error) { a2fStatus.textContent = 'Could not connect: ' + (error?.message || 'unknown error'); }
});
disconnectA2F.addEventListener('click', () => {
  if (a2fSocket) a2fSocket.close();
  a2fSocket = null;
  a2fStatus.textContent = 'Audio2Face bridge disconnected.';
});
setAvatarSourceMode();
`;
  return updated.slice(0, adjustedScriptAt) + bridgeScript + updated.slice(adjustedScriptAt);
}
