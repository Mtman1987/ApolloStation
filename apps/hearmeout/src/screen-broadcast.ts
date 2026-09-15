import {createHash,randomUUID} from 'node:crypto';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ServerResponse} from 'node:http';

type Publisher={tenantId:string;sourceRoomId:string;userId:string};
type Run={id:string;roomId:string;publisher:Publisher;title:string;directory:string;process?:ChildProcessWithoutNullStreams;sequence:number;lastHash?:string;updated:number;writing:boolean;ready:boolean;stopped:boolean};
const failure=(message:string,status=409)=>Object.assign(Error(message),{status});
/** Screen-only uploads become the same HLS format used by movies and Discord.
 * Human microphone tracks never enter this worker. A live share ends on expiry,
 * room admission loss, stop, or restart; it is not a saved/public media asset. */
export class HearMeOutScreenBroadcast {
 private runs=new Map<string,Run>();
 private stopping=new Set<Promise<void>>();
 private timer:ReturnType<typeof setInterval>;
 constructor(private options:{ffmpegBinary:string;cachePath:string;allowed:(publisher:Publisher)=>boolean;now?:()=>number}){
  this.timer=setInterval(()=>this.sweep(),1000);this.timer.unref();
 }
 private now(){return this.options.now?.()??Date.now()}
 private sweep(){for(const run of this.runs.values())if(this.now()-run.updated>20000||!this.options.allowed(run.publisher))this.stop(run)}
 async start(roomId:string,publisher:Publisher,title:string){
  this.sweep();if(this.runs.has(roomId))throw failure('Someone is already sharing to this watch party. Stop that share first.');
  if(!this.options.allowed(publisher))throw failure('Room publishing is unavailable',403);
  if(this.runs.size>=8)throw failure('All screen sharing slots are busy. Try again shortly.',503);
  const id=randomUUID(),directory=join(this.options.cachePath,'screens',id);
  const run:Run={id,roomId,publisher,title,directory,sequence:0,updated:this.now(),writing:false,ready:false,stopped:false};this.runs.set(roomId,run);
  try{
   await mkdir(directory,{recursive:true});if(run.stopped)throw failure('Screen sharing was stopped');
   const child=spawn(this.options.ffmpegBinary,['-hide_banner','-loglevel','error','-protocol_whitelist','pipe','-f','webm','-probesize','262144','-analyzeduration','1000000','-i','pipe:0','-map','0:v:0','-map','0:a:0?','-vf','scale=w=min(1280\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2','-r','24','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-pix_fmt','yuv420p','-b:v','1800k','-maxrate','2500k','-bufsize','5000k','-g','48','-keyint_min','48','-sc_threshold','0','-threads','2','-c:a','aac','-b:a','128k','-f','hls','-hls_time','2','-hls_list_size','5','-hls_flags','delete_segments+independent_segments+temp_file','-hls_segment_filename',join(directory,'segment_%06d.ts'),join(directory,'index.m3u8')],{stdio:'pipe'});
   run.process=child;child.stdout.resume();child.stderr.resume();child.stdin.on('error',()=>this.stop(run));child.once('error',()=>this.stop(run));child.once('exit',()=>this.stop(run));
   await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
   return {id,roomId};
  }catch(error){this.stop(run);throw error}
 }
 async append(roomId:string,id:string,publisher:Publisher,sequence:number,bytes:Buffer){
  const run=this.owned(roomId,id,publisher);
  if(!Number.isSafeInteger(sequence)||sequence<0||!bytes.length||bytes.length>4*1024*1024)throw failure('Invalid screen chunk',400);
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(sequence===run.sequence-1&&hash===run.lastHash)return {sequence};
  if(sequence!==run.sequence||run.writing)throw failure('Screen chunks must arrive in order');
  if(!run.process||run.process.stdin.destroyed)throw failure('Screen encoder is unavailable',503);
  run.writing=true;run.updated=this.now();
  try{await new Promise<void>((resolve,reject)=>run.process!.stdin.write(bytes,error=>error?reject(error):resolve()));run.sequence++;run.lastHash=hash;return {sequence}}
  catch{this.stop(run);throw failure('Screen encoder stopped. Share your screen again.',503)}finally{run.writing=false}
 }
 end(roomId:string,id:string,publisher:Publisher){const run=this.runs.get(roomId);if(!run)return;this.stop(this.owned(roomId,id,publisher))}
 private owned(roomId:string,id:string,publisher:Publisher){
  const run=this.runs.get(roomId);if(!run||run.id!==id||(['tenantId','sourceRoomId','userId'] as const).some(key=>run.publisher[key]!==publisher[key]))throw failure('Screen share was not found',404);
  if(!this.options.allowed(publisher)){this.stop(run);throw failure('Room publishing is unavailable',403)}return run;
 }
 state(roomId:string){
  this.sweep();const run=this.runs.get(roomId);if(!run)return {active:false,ready:false};
  if(!run.ready)try{const manifest=readFileSync(join(run.directory,'index.m3u8'),'utf8');run.ready=manifest.split(/\r?\n/).some(line=>/^segment_\d+\.ts$/.test(line)&&existsSync(join(run.directory,line)))}catch{}
  return {active:true,ready:run.ready,title:run.title,epoch:run.id,playbackUrl:'/api/watch/sessions/'+encodeURIComponent(roomId)+'/screen/'+run.id+'/index.m3u8'};
 }
 async serve(roomId:string,id:string,file:string,response:ServerResponse){
  this.sweep();const run=this.runs.get(roomId);if(!run||run.id!==id||!/^index\.m3u8$|^segment_\d+\.ts$/.test(file))throw failure('Screen share was not found',404);
  const bytes=await readFile(join(run.directory,file)).catch(()=>{throw failure('The shared screen is preparing',404)});
  // Recheck after disk I/O: stopping a share revokes all old output immediately.
  if(this.runs.get(roomId)!==run)throw failure('Screen share has ended',404);
  response.writeHead(200,{'content-type':file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(bytes);
 }
 private stop(run:Run){
  if(run.stopped)return;run.stopped=true;if(this.runs.get(run.roomId)===run)this.runs.delete(run.roomId);
  const child=run.process;
  const done=(async()=>{
   if(child&&child.exitCode===null&&child.signalCode===null){await new Promise<void>(resolve=>{
    // Spawn failures and destroyed stdin can race child exit. Shutdown is
    // bounded even when the OS never supplies a close event for that child.
    const finish=()=>{clearTimeout(kill);resolve()};
    const kill=setTimeout(()=>{child.kill('SIGKILL');finish()},1500);
    child.once('close',finish);child.once('exit',finish);child.stdin.destroy();child.kill('SIGTERM');
   })}
   await rm(run.directory,{recursive:true,force:true});
  })().catch(()=>{});
  this.stopping.add(done);void done.finally(()=>this.stopping.delete(done));
 }
 async close(){clearInterval(this.timer);for(const run of this.runs.values())this.stop(run);await Promise.all(this.stopping)}
}
