import {createHash,randomUUID} from 'node:crypto';
import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {access,mkdir,readFile,readdir,rm,stat} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import type {ServerResponse} from 'node:http';
import {HearMeOutBroadcastEgress} from './broadcast-egress.js';
import {buildHearMeOutXtreamVariantMap,type HearMeOutWatchMediaProbeV1} from './watch-hls-policy.js';
import type {HearMeOutMediaSessionV1,SqliteHearMeOutRoomMediaRuntime} from './room-media-core.js';

type Run={session:HearMeOutMediaSessionV1;cacheKey:string;signature:string;owner:string;process?:ChildProcess;pending?:Promise<void>;retryAt:number;failed:boolean;started:number};
export interface HearMeOutRoomBroadcastOptions {ffmpegBinary:string;ffprobeBinary:string;cachePath:string;spmtOrigin:string;lockBinary?:string;}

/** HMO's one playout worker per room/lane. Browsers read the output of this
 * process; viewer connect/disconnect never starts, pauses or seeks the source. */
export class HearMeOutRoomBroadcast {
  private readonly owner=randomUUID();
  private readonly runs=new Map<string,Run>();
  private readonly stopping=new Set<Promise<void>>();
  private readonly abort=new AbortController();
  private readonly egress:HearMeOutBroadcastEgress;
  private startedProcesses=0;
  private proxy='';
  private timer:ReturnType<typeof setInterval>|undefined;
  private closed=false;
  constructor(private readonly rooms:SqliteHearMeOutRoomMediaRuntime,private readonly options:HearMeOutRoomBroadcastOptions){
    if(![options.ffmpegBinary,options.ffprobeBinary,options.cachePath,options.lockBinary??'/usr/bin/flock'].every(isAbsolute))throw Error('Broadcast binaries and cache must use absolute paths');
    this.egress=new HearMeOutBroadcastEgress({origin:new URL(options.spmtOrigin).origin,pathPrefix:'/v1/media/public/'});
  }
  async listen(){await Promise.all([access(this.options.ffmpegBinary),access(this.options.ffprobeBinary),access(this.options.lockBinary??'/usr/bin/flock'),mkdir(this.options.cachePath,{recursive:true})]);this.proxy=await this.egress.listen();this.tick();this.timer=setInterval(()=>this.tick(),500);this.timer.unref();}
  status(){return {configured:true,startedProcesses:this.startedProcesses,active:[...this.runs.values()].filter(run=>run.process).length,starting:[...this.runs.values()].filter(run=>run.pending).length,failed:[...this.runs.values()].filter(run=>run.failed).length};}
  private tick(){
    if(this.closed)return;
    const sessions=this.rooms.broadcastSessions(),present=new Set(sessions.map(session=>this.cacheKey(session)));
    for(const [id,run] of this.runs)if(!present.has(id)){const stopped=this.stop(run);this.rooms.releaseBroadcast(run.session.tenantId,run.session.roomId,run.session.lane,run.owner);this.runs.delete(id);void stopped.then(()=>rm(join(this.options.cachePath,id),{recursive:true,force:true}));}
    for(const session of sessions){
      const id=this.cacheKey(session),signature=signatureFor(session);let run=this.runs.get(id);
      if(!this.rooms.claimBroadcast(session.tenantId,session.roomId,session.lane,this.owner)){if(run){void this.stop(run);this.runs.delete(id);}continue;}
      if(!run){run={session,cacheKey:id,signature,owner:this.owner,retryAt:0,failed:false,started:0};this.runs.set(id,run);}
      if(run.pending)continue;
      if(run.signature!==signature){run.session=session;run.signature=signature;run.retryAt=0;run.failed=false;}
      if(session.playback.status!=='playing'){if(run.process)void this.stop(run);continue;}
      if(Date.now()<run.retryAt)continue;
      // Signature is stored independently of ffmpeg argv; it contains no URL.
      if(run.process&&(run.process as ChildProcess & {hmoSignature?:string}).hmoSignature===signature)continue;
      const current=run;
      current.pending=this.start(current,signature).catch(()=>{current.failed=true;current.retryAt=Date.now()+5000;}).finally(()=>{delete current.pending;});
    }
  }
  private async start(run:Run,signature:string){
    await this.stop(run);if(this.closed)return;
    const session=run.session,item=session.current!.item,rawSource=new URL(item.playbackUrl,this.options.spmtOrigin),source=/^\/v1\/media\/public\/[A-Za-z0-9_-]{43}$/.test(rawSource.pathname)?new URL(rawSource.pathname,this.options.spmtOrigin):rawSource;
    if(!['http:','https:'].includes(source.protocol)||source.username||source.password)throw Error('Invalid broadcast source');
    const env={PATH:process.env.PATH??'/usr/bin:/bin',http_proxy:this.proxy,https_proxy:this.proxy,no_proxy:''};
    const {stdout}=await promisify(execFile)(this.options.ffprobeBinary,['-v','error','-protocol_whitelist','http,https,tcp,tls,crypto','-rw_timeout','15000000','-show_streams','-of','json',source.href],{env,timeout:20000,maxBuffer:1024*1024,signal:this.abort.signal});
    const probe=JSON.parse(stdout) as {streams?:Array<{index:number;codec_type:string;tags?:{language?:string;title?:string}}>},streams=probe.streams??[];
    const media:HearMeOutWatchMediaProbeV1={hasVideo:session.lane==='movie'&&streams.some(stream=>stream.codec_type==='video'),audio:streams.filter(stream=>stream.codec_type==='audio').map((stream,index)=>({sourceIndex:stream.index,index,...(stream.tags?.language?{language:stream.tags.language}:{}),...(stream.tags?.title?{title:stream.tags.title}:{})}))};
    if(!media.hasVideo&&!media.audio.length)throw Error('Source has no playable media');
    const latest=this.rooms.getRoom(session.tenantId,session.roomId)?this.rooms.getSession(session.tenantId,session.roomId,session.lane):undefined;
    if(this.closed||!latest||this.cacheKey(latest)!==run.cacheKey||signatureFor(latest)!==signature||latest.playback.status!=='playing'||!this.rooms.claimBroadcast(session.tenantId,session.roomId,session.lane,run.owner))return;
    const dir=join(this.options.cachePath,run.cacheKey);await mkdir(dir,{recursive:true});
    // Each restart appends a discontinuity to the same live feed. Bounded HLS
    // windows prevent a returning viewer from replaying their old song segment.
    const epoch=Date.now().toString(36)+'-'+randomUUID().slice(0,8),position=Math.max(0,latest.playback.position+(Date.now()-Date.parse(latest.playback.updatedAt))/1000),variants=buildHearMeOutXtreamVariantMap(media);
    const args=['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-protocol_whitelist','http,https,tcp,tls,crypto','-rw_timeout','15000000','-re',...(item.type==='live'||position<.1?[]:['-ss',String(position)]),'-i',source.href,...(media.hasVideo?['-map','0:v:0']:[]),...media.audio.flatMap(track=>['-map','0:'+track.sourceIndex]),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-force_key_frames','expr:gte(t,n_forced*2)','-c:a','aac','-ac','2','-b:a','128k','-f','hls','-hls_time','2','-hls_list_size','8','-hls_delete_threshold','3','-hls_flags','delete_segments+append_list+discont_start+omit_endlist','-var_stream_map',variants,'-master_pl_name','index.m3u8','-hls_segment_filename',join(dir,epoch+'_%v_%06d.ts'),join(dir,'stream_%v.m3u8')];
    // An OS lock survives a stalled Node supervisor and fences the encoder itself.
    const child=spawn(this.options.lockBinary??'/usr/bin/flock',['-n','-F',join(dir,'encoder.lock'),this.options.ffmpegBinary,...args],{env,stdio:['ignore','ignore','ignore']});
    (child as ChildProcess & {hmoSignature?:string}).hmoSignature=signature;run.process=child;run.started++;this.startedProcesses++;run.failed=false;
    child.on('error',()=>{if(run.process===child){delete run.process;run.failed=true;run.retryAt=Date.now()+5000;}});
    child.on('exit',code=>{if(run.process!==child)return;delete run.process;if(this.closed)return;if(code===0&&this.rooms.getRoom(session.tenantId,session.roomId)&&signatureFor(this.rooms.getSession(session.tenantId,session.roomId,session.lane))===signature)this.rooms.finishBroadcastRequest(session.tenantId,session.roomId,session.lane,session.current!.requestId);else{run.failed=true;run.retryAt=Date.now()+5000;}});
    void this.prune(dir);
  }
  private stop(run:Run){const child=run.process;if(!child)return Promise.resolve();delete run.process;const done=new Promise<void>(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);resolve();});if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);resolve();}else child.kill('SIGTERM');});this.stopping.add(done);void done.finally(()=>this.stopping.delete(done));return done;}
  private async prune(dir:string){try{for(const file of await readdir(dir)){if(!/\.ts$/.test(file))continue;const path=join(dir,file);if(Date.now()-(await stat(path)).mtimeMs>60000)await rm(path,{force:true});}}catch{/* A room can expire while the cache is being pruned. */}}
  async serve(tenantId:string,roomId:string,lane:'music'|'movie',file:string,response:ServerResponse){
    if(!/^(?:index\.m3u8|stream_[A-Za-z0-9_-]+\.m3u8|[A-Za-z0-9_-]+\.ts)$/.test(file))return this.unavailable(response,404);
    const session=this.rooms.getSession(tenantId,roomId,lane);if(!session.current)return this.unavailable(response,404);
    const path=join(this.options.cachePath,this.cacheKey(session),file);
    try{const bytes=await readFile(path);response.writeHead(200,{'content-type':file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(bytes);}catch{this.unavailable(response,503);}
  }
  private unavailable(response:ServerResponse,status:number){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','retry-after':'2'});response.end(JSON.stringify({error:'Room broadcast is starting or unavailable. The room timeline is preserved.'}));}
  private cacheKey(session:HearMeOutMediaSessionV1){const room=this.rooms.getRoom(session.tenantId,session.roomId);return key(session,room?.instanceId??room?.createdAt??'deleted');}
  async close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.abort.abort();await Promise.allSettled([...this.runs.values()].map(run=>run.pending));await Promise.allSettled([...this.runs.values()].map(run=>this.stop(run)));await Promise.allSettled([...this.stopping]);for(const run of this.runs.values())this.rooms.releaseBroadcast(run.session.tenantId,run.session.roomId,run.session.lane,run.owner);this.runs.clear();await this.egress.close();}
}
function key(session:Pick<HearMeOutMediaSessionV1,'tenantId'|'roomId'|'lane'>,instance:string){return createHash('sha256').update(JSON.stringify([session.tenantId,session.roomId,session.lane,instance])).digest('hex');}
function signatureFor(session:HearMeOutMediaSessionV1){return createHash('sha256').update(JSON.stringify([session.current?.requestId,session.current?.item.playbackUrl,session.playback.status,session.playback.position,session.playback.updatedAt])).digest('hex');}
