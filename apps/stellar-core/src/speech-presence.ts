export interface SpeechListener {id:string;widgetId:string;state:'playing'|'idle'|'muted'|'blocked';eventId:string;lastSeenAt:string}
/** Ephemeral diagnostics from authorized overlay readers, never an identity or billing signal. */
export class StellarSpeechPresence {
 private readonly listeners=new Map<string,{tenant:string;value:SpeechListener;expires:number}>();
 constructor(private readonly now:()=>number=Date.now){}
 touch(tenant:string,id:unknown,widgetId:string,state:unknown,eventId:unknown){this.prune();if(typeof id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(id)||!['playing','idle','muted','blocked'].includes(String(state)))return;const key=JSON.stringify([tenant,id]);if(!this.listeners.has(key)&&this.listeners.size>=5000)return;this.listeners.set(key,{tenant,expires:this.now()+15000,value:{id,widgetId,state:state as SpeechListener['state'],eventId:typeof eventId==='string'?eventId.slice(0,200):'',lastSeenAt:new Date(this.now()).toISOString()}})}
 list(tenant:string){this.prune();return [...this.listeners.values()].filter(l=>l.tenant===tenant).map(l=>({...l.value}))}
 private prune(){for(const [key,item] of this.listeners)if(item.expires<=this.now())this.listeners.delete(key)}
}
