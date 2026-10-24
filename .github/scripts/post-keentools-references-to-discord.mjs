import {mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const webhook = process.env.DISCORD_WEBHOOK_URL;
const archiveUrl = process.env.REFERENCE_ARCHIVE_URL;
if (!webhook) throw new Error("Missing DISCORD_WEBHOOK_URL secret.");
if (!archiveUrl) throw new Error("Provide a direct HTTPS URL for the reference ZIP.");
const wh = new URL(webhook);
if (wh.protocol !== "https:" || wh.hostname !== "discord.com" || !/^\/api\/webhooks\/\d+\/[^/]+$/.test(wh.pathname)) throw new Error("Webhook URL is not a valid Discord webhook URL.");
const ar = new URL(archiveUrl);
if (ar.protocol !== "https:" || ar.username || ar.password) throw new Error("Archive URL must be HTTPS and contain no embedded credentials.");

const temp = await mkdtemp(join(tmpdir(),"discord-ref-upload-"));
try {
  const zipPath = join(temp,"references.zip");
  const get = await fetch(ar,{redirect:"error",signal:AbortSignal.timeout(120000)});
  if (!get.ok) throw new Error(`Archive download failed: HTTP ${get.status}`);
  const zip = new Uint8Array(await get.arrayBuffer());
  if (zip.byteLength > 45*1024*1024) throw new Error("ZIP exceeds 45 MB safety limit.");
  await writeFile(zipPath,zip);
  await execFileAsync("unzip",["-q",zipPath,"-d",join(temp,"views")]);
  const {stdout} = await execFileAsync("find",[join(temp,"views"),"-type","f","-iname","*.png"]);
  const pngs = stdout.trim().split("\n").filter(Boolean).sort();
  const names = ["01_front.png","02_front_threequarter_left.png","03_left.png","04_rear_threequarter_left.png","05_back.png","06_rear_threequarter_right.png","07_right.png","08_front_threequarter_right.png","09_front_high.png","10_front_low.png"];
  const byName = new Map(pngs.map(p=>[p.split("/").pop(),p]));
  if (names.some(n=>!byName.has(n)) || pngs.length!==10) throw new Error("ZIP must contain exactly the ten expected PNG reference views.");
  const results=[];
  for(let start=0;start<names.length;start+=4) {
    const chunk=names.slice(start,start+4);
    const form=new FormData();
    const payload={content:`Neon Lock In Gamer — KeenTools reference views ${start+1}–${start+chunk.length} of 10. Keep this message for the manual head reconstruction test.`,allowed_mentions:{parse:[]},attachments:chunk.map((name,i)=>({id:String(i),filename:name}))};
    form.append("payload_json",JSON.stringify(payload));
    for(const name of chunk) {
      const bytes=await readFile(byName.get(name));
      form.append(`files[${chunk.indexOf(name)}]`,new Blob([bytes],{type:"image/png"}),name);
    }
    const resp=await fetch(webhook+"?wait=true",{method:"POST",body:form,redirect:"error",signal:AbortSignal.timeout(120000)});
    const body=await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error(`Discord upload batch ${Math.floor(start/4)+1} failed with HTTP ${resp.status}: ${String(body.message??"unknown error").slice(0,250)}`);
    if(!body.id || !Array.isArray(body.attachments) || body.attachments.length!==chunk.length) throw new Error("Discord response did not contain the expected message ID and attachment URLs.");
    results.push({message_id:body.id,channel_id:body.channel_id,attachments:body.attachments.map(a=>({filename:a.filename,url:a.url,proxy_url:a.proxy_url,size:a.size}))});
  }
  await writeFile("discord-reference-upload-result.json",JSON.stringify({purpose:"KeenTools manual head reconstruction reference images",uploaded_at:new Date().toISOString(),messages:results},null,2));
  console.log("Discord upload successful.");
  for(const m of results) console.log(JSON.stringify({message_id:m.message_id,channel_id:m.channel_id,attachments:m.attachments.map(a=>({filename:a.filename,url:a.url,size:a.size}))}));
} finally { await rm(temp,{recursive:true,force:true}); }
