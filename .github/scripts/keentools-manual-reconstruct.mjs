import {readFile, writeFile, mkdir} from "node:fs/promises";
import {resolve, join} from "node:path";

const apiKey = process.env.STREAMWEAVER_KEENTOOLS_API_KEY_SECOND;
if (!apiKey) throw new Error("Repository secret STREAMWEAVER_KEENTOOLS_API_KEY_SECOND is missing.");

const manifest = JSON.parse(await readFile(".github/data/keentools-discord-reference-upload.json", "utf8"));
const allRequired = [
  "01_front.png","02_front_threequarter_left.png","03_left.png",
  "04_rear_threequarter_left.png","05_back.png","06_rear_threequarter_right.png",
  "07_right.png","08_front_threequarter_right.png","09_front_high.png","10_front_low.png"
];
// KeenTools Cloud API supports 3–7 photos per reconstruction. Keep all ten validated
// in the manifest, but send the seven most useful facial views to its processing API.
const selected = [
  "01_front.png","02_front_threequarter_left.png","03_left.png",
  "07_right.png","08_front_threequarter_right.png","09_front_high.png","10_front_low.png"
];
const attachments = (manifest.messages ?? []).flatMap(m => m.attachments ?? []);
const byName = new Map(attachments.map(a => [a.filename, a.url]));
if (attachments.length !== 10 || allRequired.some(name => !byName.has(name))) {
  throw new Error("Discord CDN manifest must contain exactly the ten named Neon Lock In Gamer PNG views.");
}
function cdnUrl(value) {
  const u = new URL(String(value ?? ""));
  if (u.protocol !== "https:" || !["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname.toLowerCase()) || u.username || u.password) {
    throw new Error("Reference image URL is not an HTTPS Discord CDN URL.");
  }
  return u;
}
const ordered = await Promise.all(selected.map(async name => {
  const response = await fetch(cdnUrl(byName.get(name)), {redirect:"follow", signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Discord CDN download for ${name} failed (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error(`Reference ${name} is empty or exceeds 20 MB.`);
  return {name, bytes};
}));
const headers = json => ({authorization:`Bearer ${apiKey}`, ...(json ? {"content-type":"application/json"} : {})});
async function api(url, init={}) {
  const response = await fetch(url, {...init, headers:{...headers(Boolean(init.body)), ...(init.headers||{})}, redirect:"error", signal:AbortSignal.timeout(180000)});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(`KeenTools API returned HTTP ${response.status}: ${String(data.detail??data.message??"request failed").slice(0,250)}`);
  return data;
}
const init = await api("https://api.keentools.io/v1/avatar/init", {method:"POST", body:JSON.stringify({image_count:selected.length})});
const avatarId = String(init.avatar_id ?? "");
if (!/^[A-Za-z0-9_-]{4,160}$/.test(avatarId) || !Array.isArray(init.img_urls) || init.img_urls.length !== selected.length) {
  throw new Error("KeenTools returned invalid initialization data.");
}
function signedUrl(value) {
  const u = new URL(String(value ?? ""));
  if (u.protocol !== "https:" || u.username || u.password || !/^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname.toLowerCase()) || u.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" || !u.searchParams.has("X-Amz-Credential") || !u.searchParams.has("X-Amz-Signature")) {
    throw new Error("KeenTools returned an invalid signed upload/download URL.");
  }
  return u.toString();
}
await Promise.all(init.img_urls.map(async (raw, i) => {
  const response = await fetch(signedUrl(raw), {method:"PUT", headers:{"content-type":"image/png"}, body:ordered[i].bytes, redirect:"error", signal:AbortSignal.timeout(180000)});
  if (!response.ok) throw new Error(`KeenTools reference upload ${i+1} failed (HTTP ${response.status}).`);
}));
await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/process`, {method:"POST", body:JSON.stringify({focal_length_type:{focal_length_type:"estimate_common"}})});
let complete = false;
for (let i=0; i<180; i++) {
  const status = await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-status`);
  if (status.status === "completed") { complete = true; break; }
  if (status.status === "failed" || status.status === "deleted") throw new Error(`KeenTools processing failed: ${String(status.data?.error_message ?? status.status).slice(0,250)}`);
  await new Promise(r => setTimeout(r, 2000));
}
if (!complete) throw new Error("KeenTools reconstruction timed out after six minutes.");
const query = new URLSearchParams({mesh_format:"glb", mesh_lod:"high_poly", blendshapes:"arkit", texture:"png", edges:"false"});
let glb;
for (let i=0; i<30; i++) {
  const result = await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-3d-model?${query}`);
  if (result.event === "redirect") {
    const response = await fetch(signedUrl(result.data?.url), {redirect:"error", signal:AbortSignal.timeout(180000)});
    if (!response.ok) throw new Error(`GLB download failed (HTTP ${response.status}).`);
    glb = new Uint8Array(await response.arrayBuffer());
    if (glb.byteLength < 20 || glb.byteLength > 64*1024*1024 || String.fromCharCode(...glb.slice(0,4)) !== "glTF") throw new Error("Downloaded file is not a valid-size GLB.");
    break;
  }
  if (result.event !== "retry-after") throw new Error("KeenTools returned an unexpected model-download response.");
  await new Promise(r => setTimeout(r, Math.max(1, Math.min(60, Number(result.data?.time_sec)||2))*1000));
}
if (!glb) throw new Error("KeenTools model download timed out.");
const out = resolve("keentools-output");
await mkdir(out, {recursive:true});
await writeFile(join(out, "Neon_Lock_In_Gamer_Head.glb"), glb);
await writeFile(join(out, "result.txt"), `KeenTools avatar ID: ${avatarId}\nModel: Neon_Lock_In_Gamer_Head.glb\nBytes: ${glb.byteLength}\nReference set: 10 source images verified; 7 facial views sent to KeenTools API (documented limit 3–7).\n\nStandalone head reconstruction only. No Fly.io or Sprites dependency. No app deployment performed.\n`);
console.log(`KeenTools reconstruction complete. GLB size: ${glb.byteLength} bytes. Avatar ID: ${avatarId}`);
