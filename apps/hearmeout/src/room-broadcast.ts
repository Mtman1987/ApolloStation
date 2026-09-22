import {createHash,randomUUID} from 'node:crypto';
import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {access,mkdir,readFile,readdir,rm,stat} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import type {ServerResponse} from 'node:http';
import {HearMeOutBroadcastEgress} from './broadcast-egress.js';
import {HearMeOutPreparedMedia,type HearMeOutPreparedMediaOptions} from './prepared-media.js';
import {buildHearMeOutXtreamVariantMap,type HearMeOutWatchMediaProbeV1} from './watch-hls-policy.js';
import type {HearMeOutMediaSessionV1,SqliteHearMeOutRoomMediaRuntime} from './room-media-core.js';

export type HearMeOutBroadcastRuntime = Pick<SqliteHearMeOutRoomMediaRuntime,'broadcastSessions'|'claimBroadcast'|'releaseBroadcast'|'getSession'|'finishBroadcastRequest'|'getBroadcastIdentity'>;

export const HEARMEOUT_BROADCAST_PROTOCOLS='http,https,httpproxy,tcp,tls,crypto';

type Run={session:HearMeOutMediaSessionV1;cacheKey:string;signature:string;owner:string;process?:ChildProcess;pending?:Promise<void>;retryAt:number;failed:boolean;started:number;outputEpoch?:string;readyEpoch?:string};
export interface HearMeOutRoomBroadcastOptions {ffmpegBinary:string;ffprobeBinary:string;cachePath:string;spmtOrigin:string;lockBinary?:string;preparedMedia?:HearMeOutPreparedMediaOptions;startAtSessionClock?:boolean;onDiagnostic?:(value:{phase:string;message:string})=>void;}

/** HMO's playout worker for each supplied program. Browsers read the output of this
 * process; viewer connect/disconnect never starts, pauses or seeks the source. */
export class HearMeOutRoomBroadcast {
  private readonly owner=randomUUID();
  private readonly runs=new Map<string,Run>();
  private readonly stopping=new Set<Promise<void>>();
  private readonly abort=new AbortController();
  private readonly egress:HearMeOutBroadcastEgress;
  private readonly prepared:HearMeOutPreparedMedia|undefined;
  private startedProcesses=0;
  private proxy='';
  private timer:ReturnType<typeof setInterval>|undefined;
  private closed=false;
  constructor(private readonly rooms:HearMeOutBroadcastRuntime,private readonly options:HearMeOutRoomBroadcastOptions){
    if(![options.ffmpegBinary,options.ffprobeBinary,options.cachePath,options.lockBinary??'/usr/bin/flock'].every(isAbsolute))throw Error('Broadcast binaries and cache must use absolute paths');
    this.prepared=options.preparedMedia?new HearMeOutPreparedMedia(options.preparedMedia):undefined;
    this.egress=new HearMeOutBroadcastEgress({origin:new URL(options.spmtOrigin).origin,pathPrefix:'/v1/media/public/'},undefined,this.prepared);
  }
  async listen(){await Promise.all([access(this.options.ffmpegBinary),access(this.options.ffprobeBinary),access(this.options.lockBinary??'/usr/bin/flock'),mkdir(this.options.cachePath,{recursive:true})]);this.proxy=await this.egress.listen();this.tick();this.timer=setInterval(()=>this.tick(),500);this.timer.unref();}
  status(){return {configured:true,startedProcesses:this.startedProcesses,active:[...this.runs.values()].filter(run=>run.process).length,starting:[...this.runs.values()].filter(run=>run.pending).length,failed:[...this.runs.values()].filter(run=>run.failed).length};}
  epoch(tenantId:string,roomId:string,lane:'music'|'movie'){
    const session=this.rooms.getSession(tenantId,roomId,lane);
    const run=this.runs.get(this.cacheKey(session));
    return run?.process&&run.signature===signatureFor(session)?run.outputEpoch:undefined;
  }
  ready(tenantId:string,roomId:string,lane:'music'|'movie'){
    const session=this.rooms.getSession(tenantId,roomId,lane);if(!session.current)return false;
    const cacheKey=this.cacheKey(session),run=this.runs.get(cacheKey);
    if(!run?.process||run.signature!==signatureFor(session)||!run.outputEpoch)return false;
    // FFmpeg replaces live playlists in place. Once this encoder epoch has
    // produced playable media, do not flicker back to "preparing" while a
    // concurrent request catches the playlist between writes.
    if(run.readyEpoch===run.outputEpoch)return true;
    const dir=join(this.options.cachePath,cacheKey),master=join(dir,'index.m3u8');
    try{
      if(!existsSync(master))return false;
      const masterBody=readFileSync(master,'utf8'),variant=masterBody.split(/\r?\n/).map(line=>line.trim()).find(line=>line&&!line.startsWith('#'));
      if(!variant||!/^[A-Za-z0-9_-]+\.m3u8$/.test(variant))return false;
      const variantBody=readFileSync(join(dir,variant),'utf8'),segments=variantBody.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
      const ready=segments.some(segment=>segment.startsWith(run.outputEpoch+'_')&&/^[A-Za-z0-9_-]+\.ts$/.test(segment)&&existsSync(join(dir,segment)));
      if(ready)run.readyEpoch=run.outputEpoch;
      return ready;
    }catch{return false;}
  }
  browserCache(videoId:string,track?:'audio'|'video',body?:Buffer){if(!this.prepared)throw Error('Browser media caching is not configured');return this.prepared.browserCache(videoId,track,body);}
  private tick(){
    if(this.closed)return;
    const sessions=this.rooms.broadcastSessions(),present=new Set(sessions.map(session=>this.cacheKey(session)));
    for(const [id,run] of this.runs)if(!present.has(id)){const stopped=this.stop(run);this.rooms.releaseBroadcast(run.session.tenantId,run.session.roomId,run.session.lane,run.owner);this.runs.delete(id);void stopped.then(()=>rm(join(this.options.cachePath,id),{recursive:true,force:true}));}
    for(const session of sessions){
      const id=this.cacheKey(session),signature=signatureFor(session);let run=this.runs.get(id);
      if(!this.rooms.claimBroadcast(session.tenantId,session.roomId,session.lane,this.owner)){if(run){void this.stop(run);this.runs.delete(id);}continue;}
      if(!run){run={session,cacheKey:id,signature,owner:this.owner,retryAt:0,failed:false,started:0};this.runs.set(id,run);}
      if(run.pending)continue;
      if(run.signature!==signature){run.session=session;run.signature=signature;run.retryAt=0;run.failed=false;delete run.outputEpoch;delete run.readyEpoch;}
      if(session.playback.status!=='playing'){if(run.process)void this.stop(run);continue;}
      if(Date.now()<run.retryAt)continue;
      // Signature is stored independently of ffmpeg argv; it contains no URL.
      if(run.process&&(run.process as ChildProcess & {hmoSignature?:string}).hmoSignature===signature)continue;
      const current=run;
      current.pending=this.start(current,signature).catch(error=>{this.options.onDiagnostic?.({phase:'prepare',message:String(error?.stderr||error?.message||error)});current.failed=true;current.retryAt=Date.now()+5000;}).finally(()=>{delete current.pending;});
    }
  }
  private async start(run:Run,signature:string){
    await this.stop(run);if(this.closed)return;
    const startedAt=Date.now(),session=run.session,item=session.current!.item,rawSource=new URL(item.playbackUrl,this.options.spmtOrigin),source=/^\/v1\/media\/public\/[A-Za-z0-9_-]{43}$/.test(rawSource.pathname)?new URL(rawSource.pathname,this.options.spmtOrigin):this.prepared?.localSource(rawSource,session.tenantId,this.proxy)??rawSource;
    if(!validSource(source))throw Error('Invalid broadcast source');
    const audioValue=typeof item.metadata?.audioPlaybackUrl==='string'?item.metadata.audioPlaybackUrl:'';
    const rawAudio=audioValue?new URL(audioValue,this.options.spmtOrigin):undefined;
    const audioSource=rawAudio&&rawAudio.href!==rawSource.href?(this.prepared?.localSource(rawAudio,session.tenantId,this.proxy)??rawAudio):undefined;
    if(audioSource&&!validSource(audioSource))throw Error('Invalid broadcast audio source');
    const env={PATH:process.env.PATH??'/usr/bin:/bin',http_proxy:this.proxy,https_proxy:this.proxy,no_proxy:''};
    let media:HearMeOutWatchMediaProbeV1;
    if(item.source==='youtube'&&audioSource){
      media={hasVideo:true,audio:[{sourceIndex:0,sourceSpecifier:'1:0',index:0}]};
      this.options.onDiagnostic?.({phase:'prepare',message:`YouTube selected tracks accepted without preflight probes (${Date.now()-startedAt}ms)`});
    }else{
      const probe=async(url:URL)=>{const {stdout}=await promisify(execFile)(this.options.ffprobeBinary,['-v','error','-protocol_whitelist',HEARMEOUT_BROADCAST_PROTOCOLS,'-rw_timeout','15000000','-show_streams','-of','json',url.href],{env,timeout:20000,maxBuffer:1024*1024,signal:this.abort.signal});return JSON.parse(stdout) as {streams?:Array<{index:number;codec_type:string;tags?:{language?:string;title?:string}}>};};
      const [primaryProbe,audioProbe]=await Promise.all([probe(source),audioSource?probe(audioSource):Promise.resolve(undefined)]),primaryStreams=primaryProbe.streams??[],audioStreams=audioSource?(audioProbe?.streams??[]):primaryStreams;
      media={hasVideo:primaryStreams.some(stream=>stream.codec_type==='video'),audio:audioStreams.filter(stream=>stream.codec_type==='audio').map((stream,index)=>({sourceIndex:stream.index,sourceSpecifier:(audioSource?'1:':'0:')+stream.index,index,...(stream.tags?.language?{language:stream.tags.language}:{}),...(stream.tags?.title?{title:stream.tags.title}:{})}))};
    }
    if(!media.hasVideo&&!media.audio.length)throw Error('Source has no playable media');
    const latest=this.rooms.getBroadcastIdentity(session.tenantId,session.roomId)?this.rooms.getSession(session.tenantId,session.roomId,session.lane):undefined;
    if(this.closed||!latest||this.cacheKey(latest)!==run.cacheKey||signatureFor(latest)!==signature||latest.playback.status!=='playing'||!this.rooms.claimBroadcast(session.tenantId,session.roomId,session.lane,run.owner))return;
    const dir=join(this.options.cachePath,run.cacheKey);await mkdir(dir,{recursive:true});
    // Each restart gets distinct segment names and replaces the playlists. Do
    // not append the prior request's playlist: every window reloads when the
    // shared request changes, and appended entries can replay the previous song.
    const epoch=Date.now().toString(36)+'-'+randomUUID().slice(0,8),elapsed=Math.max(0,latest.playback.position+(Date.now()-Date.parse(latest.playback.updatedAt))/1000),position=this.options.startAtSessionClock?elapsed:(run.started===0?0:elapsed),variants=buildHearMeOutXtreamVariantMap(media);run.outputEpoch=epoch;delete run.readyEpoch;
    const hlsSource=item.type!=='live'&&/\.m3u8$/i.test(source.pathname),seek=item.type==='live'||position<.1?[]:['-ss',String(position)];
    const inputArgs=(url:URL,hls=false)=>['-protocol_whitelist',HEARMEOUT_BROADCAST_PROTOCOLS,'-rw_timeout','15000000','-re',...(hls?['-live_start_index','0']:[]),...seek,'-i',url.href];
    // Decoder options belong before the inputs; cap the output encoder too.
    // Keep a longer live window and publish completed segments atomically.
    const args=['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2',...inputArgs(source,hlsSource),...(audioSource?inputArgs(audioSource):[]),...(media.hasVideo?['-map','0:v:0']:[]),...media.audio.flatMap(track=>['-map',track.sourceSpecifier??'0:'+track.sourceIndex]),'-c:v','libx264','-threads:v','2','-filter_threads','1','-preset','veryfast','-pix_fmt','yuv420p','-force_key_frames','expr:gte(t,n_forced*2)','-c:a','aac','-ac','2','-b:a','128k',...(audioSource?['-shortest']:[]),'-f','hls','-hls_time','2','-hls_list_size','15','-hls_delete_threshold','5','-hls_flags','delete_segments+discont_start+omit_endlist+temp_file','-var_stream_map',variants,'-master_pl_name','index.m3u8','-hls_segment_filename',join(dir,epoch+'_%v_%06d.ts'),join(dir,'stream_%v.m3u8')];
    // Directory creation yields: a delete/close may have removed this run meanwhile.
    if(this.closed||this.runs.get(run.cacheKey)!==run||!this.rooms.getBroadcastIdentity(session.tenantId,session.roomId)||this.cacheKey(session)!==run.cacheKey||signatureFor(this.rooms.getSession(session.tenantId,session.roomId,session.lane))!==signature)return;
    // An OS lock survives a stalled Node supervisor and fences the encoder itself.
    const child=spawn(this.options.lockBinary??'/usr/bin/flock',['-n','-F',join(dir,'encoder.lock'),this.options.ffmpegBinary,...args],{env,stdio:['ignore','ignore',this.options.onDiagnostic?'pipe':'ignore']});
    child.stderr?.on('data',bytes=>this.options.onDiagnostic?.({phase:'encoder',message:String(bytes)}));
    (child as ChildProcess & {hmoSignature?:string}).hmoSignature=signature;run.process=child;run.started++;this.startedProcesses++;run.failed=false;
    this.options.onDiagnostic?.({phase:'encoder-start',message:`Broadcast encoder started in ${Date.now()-startedAt}ms`});
    child.on('error',()=>{if(run.process===child){delete run.process;delete run.outputEpoch;delete run.readyEpoch;run.failed=true;run.retryAt=Date.now()+5000;}});
    child.on('exit',code=>{if(run.process!==child)return;delete run.process;delete run.outputEpoch;delete run.readyEpoch;if(this.closed)return;if(code===0&&this.rooms.getBroadcastIdentity(session.tenantId,session.roomId)&&signatureFor(this.rooms.getSession(session.tenantId,session.roomId,session.lane))===signature)this.rooms.finishBroadcastRequest(session.tenantId,session.roomId,session.lane,session.current!.requestId);else{run.failed=true;run.retryAt=Date.now()+5000;}});
    void this.prune(dir);
  }
  private stop(run:Run){const child=run.process;if(!child)return Promise.resolve();delete run.process;const done=new Promise<void>(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);resolve();});if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);resolve();}else child.kill('SIGTERM');});this.stopping.add(done);void done.finally(()=>this.stopping.delete(done));return done;}
  private async prune(dir:string){try{for(const file of await readdir(dir)){if(!/\.ts$/.test(file))continue;const path=join(dir,file);if(Date.now()-(await stat(path)).mtimeMs>60000)await rm(path,{force:true});}}catch{/* A program can stop while the cache is being pruned. */}}
  async serve(tenantId:string,roomId:string,lane:'music'|'movie',file:string,response:ServerResponse){
    if(!/^(?:index\.m3u8|stream_[A-Za-z0-9_-]+\.m3u8|[A-Za-z0-9_-]+\.ts)$/.test(file))return this.unavailable(response,404);
    const session=this.rooms.getSession(tenantId,roomId,lane);if(!session.current)return this.unavailable(response,404);
    if(file.endsWith('.m3u8')&&!this.ready(tenantId,roomId,lane))return this.unavailable(response,503);
    const path=join(this.options.cachePath,this.cacheKey(session),file);
    try{const bytes=await readFile(path);response.writeHead(200,{'content-type':file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(bytes);}catch{this.unavailable(response,503);}
  }
  private unavailable(response:ServerResponse,status:number){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','retry-after':'2'});response.end(JSON.stringify({error:'Room broadcast is starting or unavailable. The room timeline is preserved.'}));}
  private cacheKey(session:HearMeOutMediaSessionV1){const room=this.rooms.getBroadcastIdentity(session.tenantId,session.roomId);return key(session,room?.instanceId??room?.createdAt??'deleted');}
  async close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.abort.abort();await Promise.allSettled([...this.runs.values()].map(run=>run.pending));await Promise.allSettled([...this.runs.values()].map(run=>this.stop(run)));await Promise.allSettled([...this.stopping]);for(const run of this.runs.values())this.rooms.releaseBroadcast(run.session.tenantId,run.session.roomId,run.session.lane,run.owner);this.runs.clear();await this.egress.close();}
}
function validSource(source:URL){return ['http:','https:'].includes(source.protocol)&&!source.username&&!source.password;}
function key(session:Pick<HearMeOutMediaSessionV1,'tenantId'|'roomId'|'lane'>,instance:string){return createHash('sha256').update(JSON.stringify([session.tenantId,session.roomId,session.lane,instance])).digest('hex');}
function signatureFor(session:HearMeOutMediaSessionV1){return createHash('sha256').update(JSON.stringify([session.current?.requestId,session.current?.item.playbackUrl,session.playback.status,session.playback.position,session.playback.updatedAt])).digest('hex');}