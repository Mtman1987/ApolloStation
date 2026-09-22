export const HEARMEOUT_LIVE_ORIGIN='https://hearmeout-main.fly.dev';

export interface HearMeOutLiveLoungeSession {
  id:string;
  queue:Array<any>;
  current:any|null;
  playback:{status:'idle'|'paused'|'playing';position:number;updatedAt:number;muted?:boolean;volume?:number};
  events?:Array<any>;
}

export class HearMeOutLiveLoungeBridge {
  constructor(
    private readonly authorization:string,
    private readonly origin=HEARMEOUT_LIVE_ORIGIN,
    private readonly fetchImpl:typeof fetch=fetch,
  ){
    if(!/^Bearer [^\r\n]{16,}$/.test(authorization))throw Error('Live Lounge bridge authorization is invalid');
    const url=new URL(origin);
    if(url.origin!==HEARMEOUT_LIVE_ORIGIN||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Live Lounge bridge origin is invalid');
  }
  async read():Promise<HearMeOutLiveLoungeSession>{
    return this.request('GET');
  }
  async control(action:'skip'|'clear'|'play'|'pause',expectedRequestId?:string):Promise<HearMeOutLiveLoungeSession>{
    return this.request('POST',{action,...(expectedRequestId?{expectedRequestId}:{})});
  }
  private async request(method:'GET'|'POST',body?:Record<string,string>){
    const response=await this.fetchImpl(new URL('/api/internal/lounge/media',this.origin),{
      method,
      headers:{authorization:this.authorization,accept:'application/json',...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
      redirect:'error',
      cache:'no-store',
      signal:AbortSignal.timeout(10_000),
    });
    const payload=await response.json().catch(()=>null) as {session?:HearMeOutLiveLoungeSession;error?:string}|null;
    if(!response.ok||!payload?.session)throw Object.assign(Error(payload?.error||`Live Lounge bridge returned HTTP ${response.status}`),{status:response.status});
    return normalizeSession(payload.session,this.origin);
  }
}

function normalizeSession(session:HearMeOutLiveLoungeSession,origin:string):HearMeOutLiveLoungeSession{
  const normalize=(request:any)=>{
    if(!request?.item)return request;
    const item={...request.item};
    for(const key of ['playbackUrl','poster']){
      if(typeof item[key]==='string')item[key]=absolute(item[key],origin);
    }
    if(item.metadata&&typeof item.metadata==='object'){
      item.metadata={...item.metadata};
      for(const key of ['videoPlaybackUrl','audioPlaybackUrl','embedPlaybackUrl']){
        if(typeof item.metadata[key]==='string')item.metadata[key]=absolute(item.metadata[key],origin);
      }
    }
    return {...request,item};
  };
  return {...session,current:normalize(session.current),queue:Array.isArray(session.queue)?session.queue.map(normalize):[]};
}
function absolute(value:string,origin:string){
  try{return new URL(value,origin).toString()}catch{return value}
}
