export type StreamWeaverTwitchGrantResultV1 =
  | { status:"ready"; clientId:string; accessToken:string; broadcasterId:string; moderatorId?:string; expiresAt:string }
  | { status:"reauthorization-required"|"unavailable"; reason:string };

export interface StreamWeaverTwitchGrantSourceV1 {
  getGrant(input:{ tenantId:string; capability:string }):Promise<StreamWeaverTwitchGrantResultV1>;
}

export interface StreamWeaverTwitchUserV1 { id:string; login:string; displayName:string; profileImageUrl?:string; }
export interface StreamWeaverTwitchFollowV1 { followedAt:string; broadcasterId:string; userId:string; }
export interface StreamWeaverTwitchStreamV1 { id:string; startedAt:string; title:string; gameName:string; viewerCount:number; }

export class StreamWeaverTwitchError extends Error {
  constructor(readonly status:number, message:string){ super(message); this.name="StreamWeaverTwitchError"; }
}

export class StreamWeaverTwitchCommandAdapter {
  constructor(private readonly grants:StreamWeaverTwitchGrantSourceV1, private readonly fetchImpl:typeof fetch=fetch, private readonly apiOrigin="https://api.twitch.tv/helix") {
    const origin=new URL(apiOrigin); if(origin.protocol!=="https:"||origin.username||origin.password||origin.search||origin.hash)throw new Error("Twitch API origin must be credential-free HTTPS");
  }

  async chatters(tenantId:string){const grant=await this.ready(tenantId,"chatters:read"),users:Array<{id:string;username:string}>=[];let after="";for(let page=0;page<20;page++){const response=await this.request<{data?:Array<{user_id:string;user_login:string}>,pagination?:{cursor?:string}}>(grant,this.url("/chat/chatters",{broadcaster_id:grant.broadcasterId,moderator_id:grant.moderatorId??grant.broadcasterId,first:"1000",...(after?{after}:{})}));for(const user of response.data??[])users.push({id:user.user_id,username:user.user_login});after=response.pagination?.cursor??"";if(!after)break;}return users;}
  async clips(tenantId:string,userId?:string){const grant=await this.ready(tenantId,"clips:read");const result=await this.request<{data?:Array<{id:string;url:string;embed_url:string;thumbnail_url:string;duration:number;title:string}>}>(grant,this.url("/clips",{broadcaster_id:userId??grant.broadcasterId,first:"20"}));return result.data??[];}
  async rewards(tenantId:string){const grant=await this.ready(tenantId,"rewards:read");const result=await this.request<{data?:Array<{id:string;title:string;cost:number;is_enabled:boolean}>}>(grant,this.url("/channel_points/custom_rewards",{broadcaster_id:grant.broadcasterId}));return result.data??[];}

  async redemptionStatus(tenantId:string,rewardId:string,redemptionId:string,status:"FULFILLED"|"CANCELED"){
    const grant=await this.ready(tenantId,"rewards:manage");
    const endpoint=this.url("/channel_points/custom_rewards/redemptions",{broadcaster_id:grant.broadcasterId,reward_id:cleanId(rewardId,"rewardId"),id:cleanId(redemptionId,"redemptionId")});
    // Inspect before patch so a successful provider mutation followed by a network
    // failure can be retried without treating the already-finalized reward as new.
    const current=await this.request<{data?:Array<{status:string}>}>(grant,endpoint);
    if(current.data?.[0]?.status===status)return;
    if(current.data?.[0]?.status!=="UNFULFILLED")throw new StreamWeaverTwitchError(409,"The Twitch redemption has already been finalized differently");
    await this.request(grant,endpoint,{method:"PATCH",body:{status}});
  }
  async createRewardEntry(tenantId:string,title:string,prompt:string){
    const grant=await this.ready(tenantId,"rewards:manage");
    title=boundedText(title,1,45,"title");prompt=boundedText(prompt,1,200,"prompt");
    const current=await this.request<{data?:Array<{id:string;title:string;cost:number}>}>(grant,this.url("/channel_points/custom_rewards",{broadcaster_id:grant.broadcasterId,only_manageable_rewards:"true"}));
    const existing=current.data?.find(r=>r.title===title);
    if(existing){if(existing.cost!==1)throw new Error("An existing Twitch reward with this title has a different cost");return {id:existing.id};}
    const result=await this.request<{data?:Array<{id:string}>}>(grant,this.url("/channel_points/custom_rewards",{broadcaster_id:grant.broadcasterId}),{method:"POST",body:{title:boundedText(title,1,45,"title"),prompt:boundedText(prompt,1,200,"prompt"),cost:1,is_user_input_required:false,should_redemptions_skip_request_queue:false}});
    if(!result.data?.[0]?.id)throw new Error("Twitch did not return a reward ID");return result.data[0];
  }

  async createClip(tenantId:string){
    const grant=await this.ready(tenantId,"clips:write");
    const url=this.url("/clips",{broadcaster_id:grant.broadcasterId});
    const payload=await this.request<{data?:Array<{id?:string;edit_url?:string}>}>(grant,url,{method:"POST"});
    const clip=payload.data?.[0]; if(!clip?.id)throw new Error("Twitch did not return a clip id");
    return { id:clip.id, url:`https://clips.twitch.tv/${encodeURIComponent(clip.id)}`, ...(clip.edit_url?{editUrl:clip.edit_url}:{}) };
  }

  async followers(tenantId:string){
    const grant=await this.ready(tenantId,"followers:read");
    const payload=await this.request<{total?:number}>(grant,this.url("/channels/followers",{broadcaster_id:grant.broadcasterId}));
    const total=Number(payload.total); if(!Number.isSafeInteger(total)||total<0)throw new Error("Twitch returned an invalid follower total"); return total;
  }

  async followed(tenantId:string,userId:string){
    const grant=await this.ready(tenantId,"followers:read");
    const payload=await this.request<{data?:Array<{broadcaster_id?:string;user_id?:string;followed_at?:string}>}>(grant,this.url("/channels/followers",{user_id:cleanId(userId,"userId"),broadcaster_id:grant.broadcasterId}));
    const row=payload.data?.[0]; if(!row)return undefined;
    if(!row.followed_at||!Number.isFinite(Date.parse(row.followed_at)))throw new Error("Twitch returned an invalid follow timestamp");
    return { followedAt:new Date(row.followed_at).toISOString(), broadcasterId:String(row.broadcaster_id||grant.broadcasterId), userId:String(row.user_id||userId) } satisfies StreamWeaverTwitchFollowV1;
  }

  async uptime(tenantId:string){
    const grant=await this.ready(tenantId,"streams:read");
    const payload=await this.request<{data?:Array<{id?:string;started_at?:string;title?:string;game_name?:string;viewer_count?:number}>}>(grant,this.url("/streams",{user_id:grant.broadcasterId}));
    const row=payload.data?.[0]; if(!row)return undefined;
    const viewers=Number(row.viewer_count??0); if(!row.id||!row.started_at||!Number.isFinite(Date.parse(row.started_at))||!Number.isSafeInteger(viewers)||viewers<0)throw new Error("Twitch returned an invalid live stream");
    return { id:row.id, startedAt:new Date(row.started_at).toISOString(), title:String(row.title||""), gameName:String(row.game_name||""), viewerCount:viewers } satisfies StreamWeaverTwitchStreamV1;
  }

  async setTitle(tenantId:string,title:string){
    const grant=await this.ready(tenantId,"channel:manage");
    await this.request<void>(grant,this.url("/channels",{broadcaster_id:grant.broadcasterId}),{method:"PATCH",body:{title:boundedText(title,1,140,"title")}}); return {title};
  }

  async setGame(tenantId:string,query:string){
    const grant=await this.ready(tenantId,"channel:manage");
    const search=await this.request<{data?:Array<{id?:string;name?:string}>}>(grant,this.url("/search/categories",{query:boundedText(query,1,100,"game"),first:"1"}));
    const game=search.data?.[0]; if(!game?.id||!game.name)throw new Error(`No Twitch category matched ${query}`);
    await this.request<void>(grant,this.url("/channels",{broadcaster_id:grant.broadcasterId}),{method:"PATCH",body:{game_id:game.id}}); return {id:game.id,name:game.name};
  }

  async lookupUser(tenantId:string,login:string){
    const grant=await this.ready(tenantId,"users:read");
    const payload=await this.request<{data?:Array<{id?:string;login?:string;display_name?:string;profile_image_url?:string}>}>(grant,this.url("/users",{login:cleanLogin(login)}));
    const row=payload.data?.[0]; if(!row?.id||!row.login)return undefined;
    return {id:row.id,login:row.login,displayName:String(row.display_name||row.login),...(row.profile_image_url?{profileImageUrl:row.profile_image_url}:{})} satisfies StreamWeaverTwitchUserV1;
  }

  async sendShoutout(tenantId:string,targetLogin:string){
    const grant=await this.ready(tenantId,"shoutouts:manage");
    const target=await this.lookupUserWithGrant(grant,targetLogin); if(!target)throw new Error(`Twitch user ${targetLogin} was not found`);
    const moderatorId=grant.moderatorId||grant.broadcasterId;
    await this.request<void>(grant,this.url("/chat/shoutouts",{from_broadcaster_id:grant.broadcasterId,to_broadcaster_id:target.id,moderator_id:moderatorId}),{method:"POST"});
    return target;
  }

  private async lookupUserWithGrant(grant:Extract<StreamWeaverTwitchGrantResultV1,{status:"ready"}>,login:string){
    const payload=await this.request<{data?:Array<{id?:string;login?:string;display_name?:string;profile_image_url?:string}>}>(grant,this.url("/users",{login:cleanLogin(login)}));
    const row=payload.data?.[0]; if(!row?.id||!row.login)return undefined;
    return {id:row.id,login:row.login,displayName:String(row.display_name||row.login),...(row.profile_image_url?{profileImageUrl:row.profile_image_url}:{})} satisfies StreamWeaverTwitchUserV1;
  }

  private async ready(tenantId:string,capability:string){
    cleanId(tenantId,"tenantId"); const grant=await this.grants.getGrant({tenantId,capability});
    if(grant.status!=="ready")throw new Error(grant.reason);
    if(!grant.clientId||!grant.accessToken||!grant.broadcasterId||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now())throw new Error("Twitch provider grant is incomplete or expired");
    return grant;
  }

  private url(path:string,params:Record<string,string>){ const url=new URL(path.replace(/^\/+/,""),this.apiOrigin.endsWith("/")?this.apiOrigin:`${this.apiOrigin}/`); for(const [key,value] of Object.entries(params))url.searchParams.set(key,value); return url; }
  private async request<T>(grant:Extract<StreamWeaverTwitchGrantResultV1,{status:"ready"}>,url:URL,options:{method?:string;body?:unknown}={}){
    const response=await this.fetchImpl(url,{method:options.method??"GET",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"client-id":grant.clientId,authorization:`Bearer ${grant.accessToken}`,accept:"application/json",...(options.body===undefined?{}:{"content-type":"application/json"})},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
    if(response.status===204)return undefined as T;
    const text=await response.text(); let payload:unknown=undefined; if(text){try{payload=JSON.parse(text);}catch{payload={message:text.slice(0,500)};}}
    if(!response.ok)throw new StreamWeaverTwitchError(response.status,response.status===401?"Twitch rejected the current SPMT provider grant":`Twitch request failed (${response.status})`);
    return payload as T;
  }
}

function cleanId(value:string,name:string){const clean=String(value??"").trim();if(!clean||clean.length>300||/[\r\n\0]/.test(clean))throw new Error(`${name} is invalid`);return clean;}
function cleanLogin(value:string){const clean=String(value??"").trim().replace(/^@/,"").toLowerCase();if(!/^[a-z0-9_]{1,25}$/.test(clean))throw new Error("Twitch login is invalid");return clean;}
function boundedText(value:string,min:number,max:number,name:string){const clean=String(value??"").trim();if(clean.length<min||clean.length>max||/[\r\n\0]/.test(clean))throw new Error(`${name} must be ${min}-${max} characters`);return clean;}
