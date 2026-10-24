import {mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const apiKey = process.env.STREAMWEAVER_KEENTOOLS_API_KEY;
const archiveUrl = process.env.REFERENCE_ARCHIVE_URL;
if (!apiKey) throw new Error("Repository secret STREAMWEAVER_KEENTOOLS_API_KEY is missing.");
if (!archiveUrl) throw new Error("Provide a direct HTTPS download URL for the prepared reference ZIP.");
const parsed = new URL(archiveUrl);
if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Reference archive URL must be HTTPS without embedded credentials.");

const work = await mkdtemp(join(tmpdir(), "keentools-manual-"));
try {
  const zipPath = join(work, "references.zip");
  const response = await fetch(parsed, {redirect: "error", signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Reference archive download failed (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 30 * 1024 * 1024) throw new Error("Reference archive exceeds 30 MB.");
  await writeFile(zipPath, bytes);
  await execFileAsync("unzip", ["-q", zipPath, "-d", join(work, "views")]);
  const root = join(work, "views");
  const {stdout} = await execFileAsync("find", [root, "-type", "f", "-iname", "*.png"]);
  const files = stdout.trim().split("\n").filter(Boolean).sort();
  if (files.length !== 10) throw new Error(`Expected exactly 10 PNG reference views; found ${files.length}.`);
  const views = await Promise.all(files.map(async file => ({name:file.split("/").pop(),bytes:new Uint8Array(await readFile(file))})));
  const required = ["01_front.png","02_front_threequarter_left.png","03_left.png","04_rear_threequarter_left.png","05_back.png","06_rear_threequarter_right.png","07_right.png","08_front_threequarter_right.png","09_front_high.png","10_front_low.png"];
  const byName = new Map(views.map(v => [v.name,v]));
  if (required.some(n => !byName.has(n))) throw new Error("ZIP does not contain the ten expected Neon Lock In Gamer reference filenames.");
  const ordered = required.map(n => byName.get(n));
  const headers = json => ({authorization:`Bearer ${apiKey}`,...(json?{"content-type":"application/json"}:{})});
  async function api(url, init={}) {
    const r = await fetch(url,{...init,headers:{...headers(Boolean(init.body)),...(init.headers||{})},redirect:"error",signal:AbortSignal.timeout(180000)});
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(`KeenTools API returned HTTP ${r.status}: ${String(data.detail??data.message??"request failed").slice(0,250)}`);
    return data;
  }
  const init = await api("https://api.keentools.io/v1/avatar/init",{method:"POST",body:JSON.stringify({image_count:10})});
  const avatarId = String(init.avatar_id??"");
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(avatarId) || !Array.isArray(init.img_urls) || init.img_urls.length !== 10) throw new Error("KeenTools returned invalid initialization data.");
  const signedUrl = value => {
    const u = new URL(String(value??""));
    if (u.protocol!=="https:" || u.username || u.password || !/^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname.toLowerCase()) || u.searchParams.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256" || !u.searchParams.has("X-Amz-Credential") || !u.searchParams.has("X-Amz-Signature")) throw new Error("KeenTools returned an invalid signed upload/download URL.");
    return u.toString();
  };
  await Promise.all(init.img_urls.map(async (raw,i) => {
    const r = await fetch(signedUrl(raw),{method:"PUT",headers:{"content-type":"image/png"},body:ordered[i].bytes,redirect:"error",signal:AbortSignal.timeout(180000)});
    if (!r.ok) throw new Error(`KeenTools reference upload ${i+1} failed (HTTP ${r.status}).`);
  }));
  await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/process`,{method:"POST",body:JSON.stringify({expressions_enabled:true,focal_length_type:{focal_length_type:"estimate_common"}})});
  let complete=false;
  for (let i=0;i<180;i++) {
    const s=await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-status`);
    if (s.status==="completed") {complete=true;break;}
    if (s.status==="failed" || s.status==="deleted") throw new Error(`KeenTools processing failed: ${String(s.data?.error_message??s.status).slice(0,250)}`);
    await new Promise(r=>setTimeout(r,2000));
  }
  if (!complete) throw new Error("KeenTools reconstruction timed out after six minutes.");
  const query=new URLSearchParams({mesh_format:"glb",mesh_lod:"high_poly",blendshapes:"arkit,expression",texture:"png",edges:"false"});
  let glb;
  for (let i=0;i<30;i++) {
    const result=await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-3d-model?${query}`);
    if (result.event==="redirect") {
      const r=await fetch(signedUrl(result.data?.url),{redirect:"error",signal:AbortSignal.timeout(180000)});
      if(!r.ok) throw new Error(`GLB download failed (HTTP ${r.status}).`);
      glb=new Uint8Array(await r.arrayBuffer());
      if(glb.byteLength<20 || glb.byteLength>64*1024*1024 || String.fromCharCode(...glb.slice(0,4))!=="glTF") throw new Error("Downloaded file is not a valid-size GLB.");
      break;
    }
    if(result.event!=="retry-after") throw new Error("KeenTools returned an unexpected model-download response.");
    await new Promise(r=>setTimeout(r,Math.max(1,Math.min(60,Number(result.data?.time_sec)||2))*1000));
  }
  if(!glb) throw new Error("KeenTools model download timed out.");
  const out=resolve("keentools-output");
  await import("node:fs/promises").then(fs=>fs.mkdir(out,{recursive:true}));
  await writeFile(join(out,"Neon_Lock_In_Gamer_Head.glb"),glb);
  await writeFile(join(out,"result.txt"),`KeenTools avatar ID: ${avatarId}\nModel: Neon_Lock_In_Gamer_Head.glb\nBytes: ${glb.byteLength}\nReference views: 10\n\nThis is a manual head reconstruction artifact. No app deployment was performed.\n`);
  console.log(`KeenTools reconstruction complete. GLB size: ${glb.byteLength} bytes. Avatar ID: ${avatarId}`);
} finally {
  await rm(work,{recursive:true,force:true});
}
