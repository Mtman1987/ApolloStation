type Persona={personaId:string;displayName:string;livekitIdentity:string;avatarUrl?:string;idleAvatarUrl?:string;talkingAvatarUrl?:string};
type Playback={id:string;personaId:string;identity:string;route:string;startedAt:number;duration:number;audioUrl:string};
type State={serverTime:number;personas:Persona[];playback:Playback|null;notice?:string};
export type RoomRemoteParticipant={identity:string;name:string;metadata?:string|undefined;isSpeaking?:boolean};
const photo=(value:unknown)=>{try{const url=new URL(String(value));return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}};

/** HTTP room audio is independent of RTC membership. A solo human plus any
 * number of personas never starts a cloud voice connection. */
export class HearMeOutRoomPersonaPlayer {
 private roomId='';private generation=0;private timer:ReturnType<typeof setInterval>|undefined;private startTimer:ReturnType<typeof setTimeout>|undefined;
 private audio:HTMLAudioElement|null=null;private clip:Playback|null=null;private state:State|null=null;private offset=0;private busy=false;private blocked=false;private output='';
 private remote:RoomRemoteParticipant[]=[];private speaking=new Set<string>();
 constructor(private options:{canHearNative(identity:string):boolean;volume(identity:string):number}){
  window.addEventListener('hmo:participant-speaking',event=>{const detail=(event as CustomEvent).detail;if(!detail?.identity)return;detail.speaking?this.speaking.add(detail.identity):this.speaking.delete(detail.identity);this.paintSpeaking()});
 }
 start(roomId:string){if(this.roomId===roomId){this.render();return}this.close();this.roomId=roomId;void this.refresh();this.timer=setInterval(()=>void this.refresh(),750)}
 private async refresh(){
  if(!this.roomId||this.busy)return;this.busy=true;const room=this.roomId,generation=this.generation;
  try{
   const response=await fetch('/api/hearmeout/rooms/'+encodeURIComponent(room)+'/personas/audio',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(generation!==this.generation)return;
   if([401,403,404].includes(response.status)){this.close();return}if(!response.ok)return;
   const state=await response.json() as State;if(generation!==this.generation)return;this.state=state;this.offset=state.serverTime-Date.now();this.render();this.apply(state.playback);
  }catch{if(this.clip&&this.now()>this.clip.startedAt+this.clip.duration*1000)this.clearAudio()}
  finally{if(generation===this.generation)this.busy=false}
 }
 private now(){return Date.now()+this.offset}
 private apply(clip:Playback|null){
  const native=clip?.route==='livekit'&&this.options.canHearNative(clip.identity);
  if(!clip||native||this.now()>clip.startedAt+clip.duration*1000){this.clearAudio();return}
  if(this.clip?.id===clip.id){this.updateVolume();return}
  this.clearAudio();this.clip=clip;const audio=this.audio=new Audio();audio.dataset.hmoPersonaAudio=clip.id;audio.preload='auto';audio.src=clip.audioUrl;
  audio.addEventListener('playing',()=>{if(this.audio===audio){this.blocked=false;this.emit(clip.identity,true);this.render()}});
  for(const event of ['pause','ended','error'])audio.addEventListener(event,()=>{if(this.audio===audio)this.emit(clip.identity,false)});
  audio.addEventListener('loadedmetadata',()=>{if(this.audio===audio){const position=Math.max(0,(this.now()-clip.startedAt)/1000);if(position<clip.duration)audio.currentTime=position}});
  this.updateVolume();if(this.output&&'setSinkId' in audio)void audio.setSinkId(this.output).catch(()=>{});
  const delay=Math.max(0,clip.startedAt-this.now());this.startTimer=setTimeout(()=>void this.play(),delay);
 }
 private async play(){const audio=this.audio,clip=this.clip;if(!audio||!clip||this.now()>clip.startedAt+clip.duration*1000)return;try{await audio.play()}catch{if(this.audio===audio){this.blocked=true;this.render()}}}
 resume(){if(this.audio&&this.clip){if(this.audio.readyState) this.audio.currentTime=Math.max(0,(this.now()-this.clip.startedAt)/1000);void this.play()}}
 updateVolume(){if(this.audio&&this.clip)this.audio.volume=Math.max(0,Math.min(1,this.options.volume(this.clip.identity)))}
 async setOutput(id:string){this.output=id;if(this.audio&&'setSinkId' in this.audio)await this.audio.setSinkId(id).catch(()=>{})}
 setRemote(participants:RoomRemoteParticipant[]){
  for(const previous of this.remote)this.speaking.delete(previous.identity);
  this.remote=participants;if(this.state)this.apply(this.state.playback);
  for(const participant of participants)if(participant.isSpeaking)this.speaking.add(participant.identity);
  if(this.audio&&!this.audio.paused&&this.clip)this.speaking.add(this.clip.identity);
  this.render();
 }
 private emit(identity:string,speaking:boolean){speaking=speaking||Boolean(this.roomId&&this.options.canHearNative(identity)&&this.remote.some(p=>p.identity===identity&&p.isSpeaking));window.dispatchEvent(new CustomEvent('hmo:participant-speaking',{detail:{identity,userId:identity.replace(/^persona:/,''),speaking}}))}
 private clearAudio(){clearTimeout(this.startTimer);this.startTimer=undefined;const audio=this.audio,clip=this.clip;this.audio=null;this.clip=null;this.blocked=false;if(audio){audio.pause();audio.removeAttribute('src');audio.load()}if(clip)this.emit(clip.identity,false)}
 private render(){
  const root=document.querySelector<HTMLElement>('.hmo-console');if(!root||root.dataset.roomId!==this.roomId)return;
  const list=root.querySelector('.hmo-person-list');if(!list)return;
  let host=list.querySelector<HTMLElement>('[data-hmo-remote-roster]');if(!host){host=document.createElement('div');host.dataset.hmoRemoteRoster='1';list.append(host)}
  const cards=new Map<string,{name:string;avatar:string;idle:string;talking:string;kind:string;members?:Array<{name:string;avatar:string;speaking:boolean}>;remaining?:number}>();
  for(const p of this.state?.personas||[]){if(root.querySelector('[data-hmo-persona-id="'+CSS.escape(p.personaId)+'"]'))continue;cards.set(p.livekitIdentity,{name:p.displayName,avatar:photo(p.avatarUrl),idle:photo(p.idleAvatarUrl)||photo(p.avatarUrl),talking:photo(p.talkingAvatarUrl)||photo(p.idleAvatarUrl)||photo(p.avatarUrl),kind:'Persona'});}
  for(const p of this.remote){let metadata:any={};try{metadata=JSON.parse(p.metadata||'{}')}catch{}if(metadata.hidden===true)continue;
   if(metadata.source==='discord'||p.identity.startsWith('discord-')){
    if(p.identity.startsWith('discord-bridge-listener'))continue;
    const members=Array.isArray(metadata.discordMembers)?metadata.discordMembers.slice(0,100).map((m:any)=>({name:String(m.username||m.displayName||'Discord member').slice(0,120),avatar:photo(m.photoURL),speaking:Array.isArray(metadata.activeSpeakers)&&metadata.activeSpeakers.includes(m.userId)})):undefined;
    cards.set(p.identity,{name:String(metadata.displayName||p.name||'Discord voice'),avatar:photo(metadata.photoURL),idle:photo(metadata.photoURL),talking:photo(metadata.photoURL),kind:'Discord',...(members?{members,remaining:Math.max(0,Number(metadata.memberCount||0)-members.length)}:{})});
   }else if(p.identity.startsWith('persona:')||metadata.type==='persona'){const personaId=String(metadata.personaId||p.identity.replace(/^persona:/,''));if(!root.querySelector('[data-hmo-persona-id="'+CSS.escape(personaId)+'"]'))cards.set(p.identity,{name:String(metadata.displayName||p.name),avatar:photo(metadata.avatar),idle:photo(metadata.idleAvatar)||photo(metadata.avatar),talking:photo(metadata.talkingAvatar)||photo(metadata.idleAvatar)||photo(metadata.avatar),kind:'Persona'});}
  }
  const signature=JSON.stringify([...cards]);if(host.dataset.signature!==signature){host.dataset.signature=signature;host.replaceChildren();for(const [identity,p] of cards){
   const card=document.createElement('article');card.className='hmo-person hmo-remote-person';card.dataset.hmoRemoteIdentity=identity;
   const img=document.createElement('img');img.className='hmo-persona-avatar';img.alt='';img.dataset.idle=p.idle;img.dataset.talking=p.talking;img.hidden=!p.idle;if(p.idle)img.src=p.idle;
   const name=document.createElement('strong');name.textContent=p.name;const state=document.createElement('small');state.dataset.hmoSpeakingLabel=p.kind;state.textContent=p.kind;
   const copy=document.createElement('div');copy.className='hmo-person-main';copy.append(name,state);card.append(img,copy);
   if(p.members){const members=document.createElement('div');members.className='hmo-discord-members';for(const member of p.members){const label=document.createElement('span');label.textContent=(member.speaking?'● ':'')+member.name;label.toggleAttribute('data-speaking',member.speaking);members.append(label)}if(p.remaining){const more=document.createElement('span');more.textContent='+'+p.remaining+' others';members.append(more)}card.append(members)}host.append(card);
  }}
  let notice=root.querySelector<HTMLElement>('[data-hmo-persona-audio-notice]');if(!notice){notice=document.createElement('div');notice.dataset.hmoPersonaAudioNotice='1';notice.setAttribute('role','status');list.after(notice)}notice.replaceChildren();
  if(this.blocked){const button=document.createElement('button');button.className='hmo-button';button.textContent='Enable persona audio';button.onclick=()=>this.resume();notice.append(button)}else notice.textContent=this.state?.notice||'';
  this.paintSpeaking();
 }
 private paintSpeaking(){
  for(const card of document.querySelectorAll<HTMLElement>('[data-hmo-remote-identity]')){const speaking=this.speaking.has(card.dataset.hmoRemoteIdentity!);card.toggleAttribute('data-speaking',speaking);const img=card.querySelector<HTMLImageElement>('img'),label=card.querySelector<HTMLElement>('[data-hmo-speaking-label]');if(img){const src=(speaking?img.dataset.talking:img.dataset.idle)||'';if(src&&img.getAttribute('src')!==src)img.src=src}if(label)label.textContent=speaking?'Speaking':label.dataset.hmoSpeakingLabel!;}
 }
 close(){this.generation++;this.roomId='';this.busy=false;clearInterval(this.timer);this.timer=undefined;this.clearAudio();this.state=null;this.remote=[];this.speaking.clear();document.querySelector('[data-hmo-remote-roster]')?.remove();document.querySelector('[data-hmo-persona-audio-notice]')?.remove()}
}
