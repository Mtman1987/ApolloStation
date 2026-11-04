import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

export type PersonaRoomScope={tenantId:string;roomId:string};
export type RoomSpeechPersona={personaId:string;displayName:string;targetTenantId?:string;voice?:string;wakeNames?:string[];avatarUrl?:string;idleAvatarUrl?:string;talkingAvatarUrl?:string};
export interface HearMeOutPersonaPublisher {
 join(scope:PersonaRoomScope,persona:RoomSpeechPersona):Promise<void>;
 leave(scope:PersonaRoomScope,personaId:string):Promise<void>;
 speak(scope:PersonaRoomScope,personaId:string,audio:Buffer,duration:number):Promise<void>;
}
export function personaWorkerId(id:string){return /^[A-Za-z0-9_.:-]{1,96}$/.test(id)?id:'apollo-'+createHash('sha256').update(id).digest('hex').slice(0,40)}
type Clip={id:string;tenant:string;room:string;persona:string;duration:number;started:number|null;route:string;audio:Uint8Array|null;created:number};
type Transport={tenant:string;room:string;persona:string};
const key=(scope:PersonaRoomScope,id='')=>JSON.stringify([scope.tenantId,scope.roomId,id]);

/** One synthesized clip, shared by admitted browsers. Only an open Discord
 * bridge may create persona RTC sessions. Receipts survive retries/restarts;
 * private synthesized assets are never exposed as public media. */
export class HearMeOutRoomPersonaSpeech {
 private db:DatabaseSync;
 private pending=new Map<string,Promise<void>>();
 private healthy=new Map<string,number>();
 private bridge=new Map<string,{checked:number;online:boolean}>();
 private errors=new Map<string,string>();
 private reconciling:Promise<void>|undefined;
 private timer:ReturnType<typeof setInterval>;
 private closed=false;
 constructor(path:string,private options:{
  rooms():PersonaRoomScope[];
  personas(scope:PersonaRoomScope):RoomSpeechPersona[];
  exists(scope:PersonaRoomScope):boolean;
  bridgeEnabled(scope:PersonaRoomScope):boolean;
  bridgeStatus(scope:PersonaRoomScope):Promise<boolean>;
  publisher?:HearMeOutPersonaPublisher;
  decode?(bytes:Buffer):Promise<{audio:Buffer;duration:number}>;
  ffmpegBinary?:string;
  now?:()=>number;
 }){
  this.db=new DatabaseSync(path,{timeout:5000});
  this.db.exec(`CREATE TABLE IF NOT EXISTS hmo_persona_audio(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,room TEXT NOT NULL,persona TEXT NOT NULL,duration REAL NOT NULL,started REAL,route TEXT NOT NULL,audio BLOB,created REAL NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS hmo_persona_audio_room ON hmo_persona_audio(tenant,room,created);
   CREATE TABLE IF NOT EXISTS hmo_persona_transports(tenant TEXT NOT NULL,room TEXT NOT NULL,persona TEXT NOT NULL,PRIMARY KEY(tenant,room,persona)) STRICT;
   UPDATE hmo_persona_audio SET route='done',audio=NULL WHERE started IS NOT NULL;`);
  this.timer=setInterval(()=>{void this.reconcile();this.advance()},500);this.timer.unref();
 }
 private now(){return this.options.now?.()??Date.now()}
 private present(scope:PersonaRoomScope,id:string){return this.options.exists(scope)&&this.options.personas(scope).some(p=>p.personaId===id)}
 async publish(scope:PersonaRoomScope,id:string,personaId:string,load:()=>Promise<Buffer>){
  if(this.closed||!this.present(scope,personaId))throw Error('Persona is no longer in this room');
  const receipt=createHash('sha256').update(key(scope,id)).digest('hex');
  if(this.db.prepare('SELECT 1 FROM hmo_persona_audio WHERE id=?').get(receipt))return;
  const prior=this.pending.get(receipt);if(prior)return prior;
  const task=(async()=>{
   const bytes=await load();if(!bytes.length||bytes.length>12*1024*1024)throw Error('Persona speech is too large');
   const decoded=await (this.options.decode?.(bytes)??decodePersonaSpeech(bytes,this.options.ffmpegBinary));
   if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>180||decoded.audio.length>9*1024*1024)throw Error('Persona speech must be shorter than three minutes');
   if(this.closed||!this.present(scope,personaId))throw Error('Persona is no longer in this room');
   const size=this.db.prepare('SELECT COALESCE(SUM(length(audio)),0) AS bytes FROM hmo_persona_audio').get()!;
   const count=this.db.prepare("SELECT COUNT(*) AS count FROM hmo_persona_audio WHERE tenant=? AND room=? AND route='queued'").get(scope.tenantId,scope.roomId)!;
   if(Number(size.bytes)+decoded.audio.length>128*1024*1024||Number(count.count)>=12)throw Error('Room speech queue is full; try again shortly');
   this.db.prepare("INSERT OR IGNORE INTO hmo_persona_audio VALUES(?,?,?,?,?,NULL,'queued',?,?)").run(receipt,scope.tenantId,scope.roomId,personaId,decoded.duration,decoded.audio,this.now());
   this.advance();
  })().finally(()=>this.pending.delete(receipt));this.pending.set(receipt,task);return task;
 }
 state(scope:PersonaRoomScope){
  const clip=this.current(scope),now=this.now();
  return {serverTime:now,personas:this.options.personas(scope).map(persona=>({...persona,livekitIdentity:'persona:'+personaWorkerId(persona.personaId),transportHealthy:this.healthy.has(key(scope,persona.personaId))&&this.options.bridgeEnabled(scope)})),
   playback:clip?{id:clip.id,personaId:clip.persona,identity:'persona:'+personaWorkerId(clip.persona),route:clip.route,startedAt:clip.started,duration:clip.duration,audioUrl:'/api/hearmeout/rooms/'+encodeURIComponent(scope.roomId)+'/personas/audio/'+clip.id}:null,
   notice:this.errors.get(key(scope))||''};
 }
 audio(scope:PersonaRoomScope,id:string){
  const clip=this.db.prepare('SELECT * FROM hmo_persona_audio WHERE id=? AND tenant=? AND room=?').get(id,scope.tenantId,scope.roomId) as Clip|undefined;
  if(!clip?.audio||!this.present(scope,clip.persona)||clip.created+600000<this.now())throw Error('Room speech was not found');return Buffer.from(clip.audio);
 }
 private current(scope:PersonaRoomScope){return this.db.prepare("SELECT * FROM hmo_persona_audio WHERE tenant=? AND room=? AND route IN ('browser','livekit') ORDER BY created,rowid LIMIT 1").get(scope.tenantId,scope.roomId) as Clip|undefined}
 private advance(){
  if(this.closed)return;
  const now=this.now();this.db.prepare("UPDATE hmo_persona_audio SET route='done',audio=NULL WHERE (started IS NOT NULL AND started+duration*1000+1000<?) OR created+600000<?").run(now,now);
  for(const scope of this.options.rooms()){
   if(this.current(scope))continue;
   const clip=this.db.prepare("SELECT * FROM hmo_persona_audio WHERE tenant=? AND room=? AND route='queued' ORDER BY created,rowid LIMIT 1").get(scope.tenantId,scope.roomId) as Clip|undefined;
   if(!clip)continue;if(!this.present(scope,clip.persona)){this.db.prepare("UPDATE hmo_persona_audio SET route='done',audio=NULL WHERE id=?").run(clip.id);continue}
   const native=this.options.bridgeEnabled(scope)&&this.bridge.get(key(scope))?.online&&this.healthy.has(key(scope,clip.persona));
   this.db.prepare('UPDATE hmo_persona_audio SET route=?,started=? WHERE id=?').run(native?'livekit':'browser',now+(native?0:600),clip.id);
   if(native&&this.options.publisher&&clip.audio){void this.options.publisher.speak(scope,clip.persona,Buffer.from(clip.audio),clip.duration).catch(async()=>{
    // Do not blindly replay an uncertain worker POST. Remove that publisher
    // before allowing browsers to continue from the same clip position.
    try{await this.options.publisher!.leave(scope,clip.persona);this.healthy.delete(key(scope,clip.persona));if(!this.closed)this.db.prepare("UPDATE hmo_persona_audio SET route='browser' WHERE id=? AND route='livekit'").run(clip.id)}catch{}
    this.errors.set(key(scope),'Persona room audio is recovering. Discord speech is temporarily unavailable.');
   });}
  }
 }
 reconcile(){
  if(this.closed)return Promise.resolve();if(this.reconciling)return this.reconciling;
  this.reconciling=this.reconcileAll().catch(()=>{}).finally(()=>{this.reconciling=undefined});return this.reconciling;
 }
 private async reconcileAll(){
  const scopes=new Map(this.options.rooms().map(scope=>[key(scope),scope]));
  for(const row of this.db.prepare('SELECT DISTINCT tenant,room FROM hmo_persona_audio').all())scopes.set(key({tenantId:String(row.tenant),roomId:String(row.room)}),{tenantId:String(row.tenant),roomId:String(row.room)});
  for(const row of this.db.prepare('SELECT DISTINCT tenant,room FROM hmo_persona_transports').all())scopes.set(key({tenantId:String(row.tenant),roomId:String(row.room)}),{tenantId:String(row.tenant),roomId:String(row.room)});
  await Promise.all([...scopes.values()].map(async scope=>{
   try{
    let online=false;
    if(!this.closed&&this.options.exists(scope)&&this.options.bridgeEnabled(scope)&&this.options.publisher){
     let status=this.bridge.get(key(scope));if(!status||status.checked+3000<this.now()){status={checked:this.now(),online:await this.options.bridgeStatus(scope)};this.bridge.set(key(scope),status)}online=status.online;
    }else this.bridge.delete(key(scope));
    const personas=online?this.options.personas(scope):[],wanted=new Set(personas.map(p=>p.personaId));
    const tracked=this.db.prepare('SELECT * FROM hmo_persona_transports WHERE tenant=? AND room=?').all(scope.tenantId,scope.roomId) as Transport[];
    for(const row of tracked)if(!wanted.has(row.persona)){
     await this.options.publisher?.leave(scope,row.persona);this.healthy.delete(key(scope,row.persona));this.db.prepare('DELETE FROM hmo_persona_transports WHERE tenant=? AND room=? AND persona=?').run(scope.tenantId,scope.roomId,row.persona);
     this.db.prepare("UPDATE hmo_persona_audio SET route='browser' WHERE tenant=? AND room=? AND persona=? AND route='livekit'").run(scope.tenantId,scope.roomId,row.persona);
    }
    for(const persona of personas){
     const k=key(scope,persona.personaId);if(this.healthy.has(k)&&this.healthy.get(k)!+15000>this.now())continue;
     this.db.prepare('INSERT OR IGNORE INTO hmo_persona_transports VALUES(?,?,?)').run(scope.tenantId,scope.roomId,persona.personaId);
     await this.options.publisher!.join(scope,persona);
     if(this.closed||!this.options.bridgeEnabled(scope)||!this.present(scope,persona.personaId)){await this.options.publisher!.leave(scope,persona.personaId);this.healthy.delete(k)}else this.healthy.set(k,this.now());
    }
    if(!this.options.exists(scope)){this.db.prepare('DELETE FROM hmo_persona_audio WHERE tenant=? AND room=?').run(scope.tenantId,scope.roomId)}
    else for(const row of this.db.prepare("SELECT id,persona FROM hmo_persona_audio WHERE tenant=? AND room=? AND route!='done'").all(scope.tenantId,scope.roomId))if(!this.present(scope,String(row.persona)))this.db.prepare("UPDATE hmo_persona_audio SET route='done',audio=NULL WHERE id=?").run(String(row.id));
    this.errors.delete(key(scope));
   }catch{this.errors.set(key(scope),'Persona bridge connection is unavailable. Browser room speech remains available.');this.bridge.delete(key(scope))}
  }));
 }
 async close(){this.closed=true;clearInterval(this.timer);await this.reconciling;await Promise.allSettled(this.pending.values());for(const row of this.db.prepare('SELECT * FROM hmo_persona_transports').all() as Transport[]){try{await this.options.publisher?.leave({tenantId:row.tenant,roomId:row.room},row.persona);this.db.prepare('DELETE FROM hmo_persona_transports WHERE tenant=? AND room=? AND persona=?').run(row.tenant,row.room,row.persona)}catch{}}this.db.close()}
}

export async function decodePersonaSpeech(input:Buffer,binary='ffmpeg'):Promise<{audio:Buffer;duration:number}>{
 const pcm=await new Promise<Buffer>((resolve,reject)=>{
  const child=spawn(binary,['-hide_banner','-loglevel','error','-protocol_whitelist','pipe','-i','pipe:0','-t','181','-f','s16le','-acodec','pcm_s16le','-ar','24000','-ac','1','pipe:1'],{stdio:'pipe'}),chunks:Buffer[]=[];let size=0;
  const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Persona audio decoding timed out'))},15000);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>9*1024*1024){child.kill('SIGKILL');return}chunks.push(chunk)});child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('close',code=>{clearTimeout(timeout);code===0?resolve(Buffer.concat(chunks)):reject(Error('Persona audio could not be decoded'))});child.stdin.end(input);
 });
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return {audio:Buffer.concat([header,pcm]),duration:pcm.length/48000};
}
