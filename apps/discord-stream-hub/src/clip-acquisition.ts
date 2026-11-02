import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DshLiveMemberDirectoryV1 } from "./twitch-live-poller.js";
import type { SqliteDshClipGifStore } from "./clip-gif-library.js";

const run=promisify(execFile);
const MAX_SOURCE_BYTES=80*1024*1024;
const MAX_GIF_BYTES=50*1024*1024;
const CYCLE_MS=10*60*1000;

export interface DshClipGrantV1 { status:"ready";clientId:string;accessToken:string;expiresAt:string; }
export interface DshClipGrantSourceV1 { getClipGrant(tenantId:string):Promise<DshClipGrantV1|{status:"unavailable"|"reauthorization-required";reason:string}>; }

/** Acquires real Twitch clips through the tenant's SPMT grant and renders bounded GIFs. */
export class DshClipAcquisitionWorker {
 private readonly lastRun=new Map<string,number>();
 private readonly inFlight=new Set<string>();
 constructor(private readonly members:DshLiveMemberDirectoryV1,private readonly grants:DshClipGrantSourceV1,private readonly store:SqliteDshClipGifStore,private readonly fetchImpl:typeof fetch=fetch,private readonly now:()=>number=Date.now){}
 async runOnce(tenantId:string){
  if(this.inFlight.has(tenantId)||this.now()-(this.lastRun.get(tenantId)??0)<CYCLE_MS)return {status:"skipped" as const};
  this.inFlight.add(tenantId);this.lastRun.set(tenantId,this.now());
  try{
   const grant=await this.grants.getClipGrant(tenantId);if(grant.status!=="ready")return {status:grant.status,reason:grant.reason};
   const tracked=await this.members.listLiveTrackedMembers(tenantId),unique=[...new Map(tracked.map(member=>[member.twitchLogin.toLowerCase(),member])).values()];
   let creators=0,clipsSaved=0;
   for(const member of unique.slice(0,20)){
    const login=member.twitchLogin.toLowerCase(),fresh=this.store.list(tenantId,login).filter(item=>this.now()-Date.parse(item.capturedAt)<24*60*60*1000);
    if(fresh.length>=2)continue;
    const user=await this.getUser(grant,login);if(!user)continue;
    const clips=await this.getClips(grant,user.id);if(!clips.length)continue;
    const known=new Set(this.store.list(tenantId,login).map(item=>item.clipId));
    const candidates=[...clips].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,20);
    let saved=0;
    for(const clip of candidates){
      if(saved>=2||known.has(clip.id))continue;
      try{
       const gif=await this.renderClip(grant,clip.id);
       if(!gif)continue;
       this.store.put({schemaVersion:1,tenantId,streamerLogin:login,clipId:clip.id,capturedAt:clip.created_at,durationSeconds:Math.max(1,Math.min(60,Math.ceil(clip.duration))),sourceUrl:clip.url,gif});
       saved++;clipsSaved++;
      }catch{/* A bad or unavailable clip must not block other creators. */}
    }
    if(saved)creators++;
   }
   return {status:"completed" as const,creators,clipsSaved};
  }finally{this.inFlight.delete(tenantId);}
 }
 private async getUser(grant:DshClipGrantV1,login:string){
  const url=new URL("https://api.twitch.tv/helix/users");url.searchParams.set("login",login);
  const response=await this.fetchImpl(url,{headers:headers(grant),redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("Twitch user lookup failed");
  const body=await response.json() as {data?:Array<{id:string;login:string}>};
  return body.data?.find(row=>row.login.toLowerCase()===login&&/^\\d{1,30}$/.test(row.id));
 }
 private async getClips(grant:DshClipGrantV1,broadcasterId:string){
  const url=new URL("https://api.twitch.tv/helix/clips");url.searchParams.set("broadcaster_id",broadcasterId);url.searchParams.set("first","20");
  const response=await this.fetchImpl(url,{headers:headers(grant),redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("Twitch clips lookup failed");
  const body=await response.json() as {data?:Array<{id:string;url:string;created_at:string;duration:number}>};
  return (body.data??[]).filter(row=>/^[A-Za-z0-9_-]{1,120}$/.test(row.id)&&Number.isFinite(Date.parse(row.created_at))&&Number.isFinite(row.duration)&&row.duration>0&&row.duration<=60&&isHttps(row.url));
 }
 private async renderClip(grant:DshClipGrantV1,clipId:string):Promise<Uint8Array|undefined>{
  const query={query:`{ clip(slug: "${clipId}") { playbackAccessToken(params: {platform: "web", playerType: "embed"}) { signature value } videoQualities { quality sourceURL } } }`};
  const gql=await this.fetchImpl("https://gql.twitch.tv/gql",{method:"POST",headers:{"client-id":grant.clientId,"content-type":"application/json"},body:JSON.stringify(query),redirect:"error",signal:AbortSignal.timeout(20000)});
  if(!gql.ok)return undefined;
  const payload=await gql.json() as {data?:{clip?:{playbackAccessToken?:{signature?:string;value?:string};videoQualities?:Array<{quality:string;sourceURL:string}>}}};
  const clip=payload.data?.clip,qualities=(clip?.videoQualities??[]).filter(item=>isTwitchCdn(item.sourceURL));
  if(!qualities.length)return undefined;
  qualities.sort((a,b)=>Number(b.quality)-Number(a.quality));
  const selected=qualities.find(item=>Number(item.quality)<=480)??qualities[qualities.length-1]!;
  const url=new URL(selected.sourceURL);
  if(clip?.playbackAccessToken?.signature&&clip.playbackAccessToken.value){url.searchParams.set("sig",clip.playbackAccessToken.signature);url.searchParams.set("token",clip.playbackAccessToken.value);}
  const response=await this.fetchImpl(url,{headers:{accept:"video/mp4,*/*","user-agent":"Mozilla/5.0"},redirect:"error",signal:AbortSignal.timeout(60000)});
  if(!response.ok||!response.body)return undefined;
  const chunks:Uint8Array[]=[];let size=0;
  for await(const chunk of response.body as any){const part=Buffer.from(chunk);size+=part.byteLength;if(size>MAX_SOURCE_BYTES)throw new Error("Twitch clip source exceeds the 80 MB limit");chunks.push(part);}
  const directory=await mkdtemp(join(tmpdir(),"dsh-twitch-clip-"));
  try{
   const input=join(directory,"source.mp4"),palette=join(directory,"palette.png"),output=join(directory,"clip.gif");
   await writeFile(input,Buffer.concat(chunks));
   await run("ffmpeg",["-y","-threads","1","-i",input,"-vf","fps=12,scale=320:-1:flags=fast_bilinear,palettegen=max_colors=96",palette],{timeout:90000,maxBuffer:1024*1024});
   await run("ffmpeg",["-y","-threads","1","-i",input,"-i",palette,"-filter_complex_threads","1","-filter_complex","fps=12,scale=320:-1:flags=fast_bilinear[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5","-loop","0",output],{timeout:90000,maxBuffer:1024*1024});
   let gif=await readFile(output);
   if(gif.byteLength>MAX_GIF_BYTES){
    const bounded=join(directory,"bounded.gif");
    await run("ffmpeg",["-y","-threads","1","-i",output,"-filter_complex_threads","1","-vf","fps=8,scale=240:-2:flags=lanczos","-loop","0",bounded],{timeout:90000,maxBuffer:1024*1024});
    gif=await readFile(bounded);
   }
   if(gif.byteLength>MAX_GIF_BYTES||gif.toString("ascii",0,6)!=="GIF89a")throw new Error("Rendered GIF is invalid or exceeds 50 MB");
   return gif;
  }finally{await rm(directory,{recursive:true,force:true});}
 }
}
function headers(grant:DshClipGrantV1){return {"client-id":grant.clientId,authorization:`Bearer ${grant.accessToken}`};}
function isHttps(value:string){try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password;}catch{return false;}}
function isTwitchCdn(value:string){try{const url=new URL(value);return url.protocol==="https:"&&(url.hostname==="clips-media-assets2.twitch.tv"||url.hostname.endsWith(".twitchcdn.net")||url.hostname==="twitchcdn.net")&&!url.username&&!url.password;}catch{return false;}}
