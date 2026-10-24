import {readFile, writeFile, mkdir, mkdtemp, readdir, rm} from "node:fs/promises";
import {resolve, join, basename} from "node:path";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const apiKey = process.env.STREAMWEAVER_KEENTOOLS_API_KEY_SECOND;
const discordToken = process.env.DISCORD_BOT_TOKEN;
const channelId = "1476540488147533895";
const messageId = process.env.DISCORD_REFERENCE_MESSAGE_ID || "1563674871119216749";
if (!apiKey) throw new Error("Repository secret STREAMWEAVER_KEENTOOLS_API_KEY_SECOND is missing.");
if (!discordToken) throw new Error("Repository secret DISCORD_BOT_TOKEN is missing; cannot read the exact Discord reference message.");
if (!/^\d{17,20}$/.test(messageId)) throw new Error("Discord reference message ID is invalid.");

const temp = await mkdtemp(join(tmpdir(), "keentools-exact-discord-"));
try {
  // GitHub secrets are sometimes stored with the Discord scheme prefix already included.
  // Normalize it so we never send the invalid header "Bot Bot <token>".
  const normalizedToken = discordToken.trim().replace(/^Bot\s+/i, "");
  const auth = {authorization: `Bot ${normalizedToken}`, accept: "application/json"};
  const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {headers:auth, signal:AbortSignal.timeout(30000)});
  if (!messageResponse.ok) {
    const discordError = await messageResponse.json().catch(() => ({}));
    const code = discordError.code ? `; Discord code ${discordError.code}` : "";
    const detail = discordError.message ? `; ${String(discordError.message).slice(0,160)}` : "";
    throw new Error(`Could not read requested Discord message ${messageId}: HTTP ${messageResponse.status}${code}${detail}. Auth scheme was normalized without logging the token.`);
  }
  const message = await messageResponse.json();
  if (message.id !== messageId || message.channel_id !== channelId) throw new Error("Discord returned a different message/channel; refusing to use it.");
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!attachments.length) throw new Error(`The exact Discord message ${messageId} contains no attachments.`);
  console.log(`Using exact Discord message ${messageId}; attachment count: ${attachments.length}.`);
  const downloaded = [];
  for (let i=0; i<attachments.length; i++) {
    const a = attachments[i];
    const u = new URL(String(a.url ?? ""));
    if (u.protocol !== "https:" || !["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname)) throw new Error(`Attachment ${i+1} is not a Discord CDN URL.`);
    const response = await fetch(u, {redirect:"follow", signal:AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error(`Downloading attachment ${a.filename ?? i+1} failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > 50*1024*1024) throw new Error(`Attachment ${a.filename ?? i+1} is empty or too large.`);
    const path = join(temp, basename(String(a.filename || `attachment-${i+1}`)).replace(/[^a-zA-Z0-9._-]/g, "_"));
    await writeFile(path, bytes);
    downloaded.push(path);
    console.log(`Fetched attachment ${i+1}: ${basename(path)} (${bytes.byteLength} bytes)`);
  }
  const imageDir = join(temp, "images");
  await mkdir(imageDir);
  for (const path of downloaded) {
    if (/\.zip$/i.test(path)) {
      await execFileAsync("unzip", ["-o", "-q", path, "-d", imageDir]);
    } else if (/\.(png|jpe?g|webp)$/i.test(path)) {
      await writeFile(join(imageDir, basename(path)), await readFile(path));
    } else {
      console.log(`Ignoring non-image, non-ZIP attachment: ${basename(path)}`);
    }
  }
  const walk = async dir => {
    const out=[];
    for (const e of await readdir(dir,{withFileTypes:true})) {
      const p=join(dir,e.name);
      if (e.isDirectory()) out.push(...await walk(p));
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) out.push(p);
    }
    return out;
  };
  const paths = await walk(imageDir);
  if (paths.length !== 10) throw new Error(`The exact message must provide exactly 10 reference images after extracting any ZIP; found ${paths.length}. No other message or old manifest will be substituted.`);
  const expected = [
    "01_front.png","02_front_threequarter_left.png","03_left.png",
    "04_rear_threequarter_left.png","05_back.png","06_rear_threequarter_right.png",
    "07_right.png","08_front_threequarter_right.png","09_front_high.png","10_front_low.png"
  ];
  const norm = s => basename(s).toLowerCase().replace(/[^a-z0-9]/g,"");
  const orderedPaths = [];
  const used = new Set();
  for (const target of expected) {
    const exact = paths.find(p => norm(p) === norm(target) && !used.has(p));
    if (exact) { orderedPaths.push(exact); used.add(exact); }
  }
  if (orderedPaths.length !== 10) {
    const sorted = [...paths].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    console.log("Reference filenames do not exactly match canonical names; using the natural filename order from the linked message ZIP.");
    orderedPaths.splice(0, orderedPaths.length, ...sorted);
  }
  const ordered = await Promise.all(orderedPaths.map(async (path, i) => {
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.length < 100 || bytes.length > 20*1024*1024) throw new Error(`Reference image ${i+1} is empty or exceeds 20 MB.`);
    return {name:expected[i], bytes};
  }));

  const headers = json => ({authorization:`Bearer ${apiKey}`, ...(json ? {"content-type":"application/json"} : {})});
  async function api(url, init={}) {
    const response = await fetch(url, {...init, headers:{...headers(Boolean(init.body)), ...(init.headers||{})}, redirect:"error", signal:AbortSignal.timeout(180000)});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(`KeenTools API returned HTTP ${response.status}: ${String(data.detail??data.message??"request failed").slice(0,250)}`);
    return data;
  }
  function signedUrl(value) {
    const u = new URL(String(value ?? ""));
    if (u.protocol !== "https:" || u.username || u.password || !/^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname.toLowerCase()) || u.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" || !u.searchParams.has("X-Amz-Credential") || !u.searchParams.has("X-Amz-Signature")) {
      throw new Error("KeenTools returned an invalid signed upload/download URL.");
    }
    return u.toString();
  }

  console.log(`Validated 10 images fetched directly from Discord message ${messageId}; starting KeenTools.`);
  const init = await api("https://api.keentools.io/v1/avatar/init", {method:"POST", body:JSON.stringify({image_count:10})});
  const avatarId = String(init.avatar_id ?? "");
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(avatarId) || !Array.isArray(init.img_urls) || init.img_urls.length !== 10) {
    throw new Error("KeenTools returned invalid initialization data.");
  }
  await Promise.all(init.img_urls.map(async (raw, i) => {
    const response = await fetch(signedUrl(raw), {method:"PUT", headers:{"content-type":"image/png"}, body:ordered[i].bytes, redirect:"error", signal:AbortSignal.timeout(180000)});
    if (!response.ok) throw new Error(`KeenTools reference upload ${i+1} failed (HTTP ${response.status}).`);
  }));
  await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/process`, {method:"POST", body:JSON.stringify({expressions_enabled:true, focal_length_type:{focal_length_type:"estimate_common"}})});
  let complete = false;
  let lastStatus;
  for (let i=0; i<180; i++) {
    const status = await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-status`);
    lastStatus = status.status;
    if (status.status === "completed") { complete = true; break; }
    if (status.status === "failed" || status.status === "deleted") throw new Error(`KeenTools processing failed: ${String(status.data?.error_message ?? status.status).slice(0,250)}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!complete) throw new Error(`KeenTools reconstruction timed out after six minutes; last status=${String(lastStatus)}.`);
  const query = new URLSearchParams({mesh_format:"glb", mesh_lod:"high_poly", blendshapes:"arkit,expression", texture:"png", edges:"false"});
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
  await writeFile(join(out, "result.txt"), `KeenTools avatar ID: ${avatarId}\nModel: Neon_Lock_In_Gamer_Head.glb\nBytes: ${glb.byteLength}\nSource: exact Discord message ${messageId} in channel ${channelId}; 10 images downloaded directly by Actions.\nStandalone head reconstruction only. No Fly.io or app deployment performed.\n`);
  console.log(`KeenTools reconstruction complete. GLB size: ${glb.byteLength} bytes. Avatar ID: ${avatarId}`);
} finally {
  await rm(temp, {recursive:true, force:true});
}
