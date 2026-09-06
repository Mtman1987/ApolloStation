import type { OutboundChatMessageV1 } from "@spmt/contracts";
import type { ProviderConnectionDriverV1 } from "./connection-supervisor.js";
import type { ChatProviderSenderV1, ProviderChatEnvelopeV1 } from "./index.js";

/** YouTube live-chat polling respects the interval supplied by YouTube. */
export class YouTubeLiveChatDriver implements ProviderConnectionDriverV1,ChatProviderSenderV1 {
  readonly provider="youtube" as const;
  private readonly active=new Map<string,{token:string;liveChatId:string}>();
  constructor(private readonly fetchImpl:typeof fetch=fetch){}
  async open(input:Parameters<ProviderConnectionDriverV1['open']>[0]){
    const connection=input.connection,key=JSON.stringify([connection.tenantId,connection.connectionId]);
    let liveChatId=input.grantMetadata.liveChatId;
    if(!liveChatId){const result=await this.request("liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&maxResults=50",input.accessToken);const broadcast=result.items?.find((item:any)=>!connection.channelId||item.snippet?.channelId===connection.channelId);liveChatId=broadcast?.snippet?.liveChatId;}
    if(!liveChatId)throw new Error("No active YouTube live chat was found for this channel");
    this.active.set(key,{token:input.accessToken,liveChatId});let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,pageToken=input.resumeCursor;
    const poll=async(initial=false)=>{try{const query=new URLSearchParams({liveChatId:liveChatId!,part:"id,snippet,authorDetails",maxResults:"200",...(pageToken?{pageToken}:{})}),value=await this.request("liveChat/messages?"+query,input.accessToken);
      for(const item of value.items??[]){if(stopped)return;const s=item.snippet??{},a=item.authorDetails??{};if(!item.id||!a.channelId)continue;const rich=youTubeRichEvent(s),text=String(s.displayMessage??s.textMessageDetails?.messageText??rich?.donation??rich?.membership??"");if(!text)continue;
        const message:ProviderChatEnvelopeV1={schemaVersion:1,tenantId:connection.tenantId,provider:"youtube",connectionId:connection.connectionId,channelId:connection.channelId,messageId:String(item.id),text:text.slice(0,8000),occurredAt:String(s.publishedAt??new Date().toISOString()),providerUserId:String(a.channelId),username:String(a.displayName??a.channelId),displayName:String(a.displayName??a.channelId),roles:a.isChatOwner?["broadcaster"]:a.isChatModerator?["moderator"]:["member"],mentions:[],...(rich?{rich}:{})};
        await input.onEnvelope(message);
      }
      pageToken=typeof value.nextPageToken==="string"?value.nextPageToken:undefined;if(pageToken)input.onCursor(pageToken);
      if(!stopped)timer=setTimeout(()=>void poll(),Math.max(1000,Number(value.pollingIntervalMillis)||5000));
    }catch(error){if(initial){this.active.delete(key);throw error;}if(!stopped){this.active.delete(key);input.onDisconnect({kind:/401|403/.test(String(error))?"authentication":"transport",reason:"YouTube live chat polling failed"});}}};
    await poll(true);return{close:()=>{stopped=true;if(timer)clearTimeout(timer);this.active.delete(key);}};
  }
  async send(message:OutboundChatMessageV1){const active=this.active.get(JSON.stringify([message.tenantId,message.connectionId]));if(!active)throw new Error("YouTube chat is unavailable");const value=await this.request("liveChat/messages?part=snippet",active.token,{method:"POST",body:JSON.stringify({snippet:{liveChatId:active.liveChatId,type:"textMessageEvent",textMessageDetails:{messageText:message.text}}})});if(!value.id)throw new Error("YouTube did not acknowledge the message");return{providerMessageId:String(value.id)};}
  private async request(path:string,token:string,init:RequestInit={}){const response=await this.fetchImpl("https://www.googleapis.com/youtube/v3/"+path,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},redirect:"error",signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`YouTube returned HTTP ${response.status}`);return await response.json() as Record<string,any>;}
}

/** See YouTube liveChatMessages resource; membership events may have no textMessageDetails. */
export function youTubeRichEvent(snippet:Record<string,any>):ProviderChatEnvelopeV1["rich"]|undefined {
 const type=String(snippet.type??""),paid=type==="superChatEvent"?snippet.superChatDetails:type==="superStickerEvent"?snippet.superStickerDetails:undefined;
 if(paid)return {source:"youtube",eventType:type,attachments:[],donation:String(paid.amountDisplayString??"Paid message").slice(0,100)};
 const member=type==="newSponsorEvent"?snippet.newSponsorDetails:type==="memberMilestoneChatEvent"?snippet.memberMilestoneChatDetails:type==="giftMembershipReceivedEvent"?snippet.giftMembershipReceivedDetails:type==="membershipGiftingEvent"?snippet.membershipGiftingDetails:undefined;
 if(member){const count=Number(member.giftMembershipsCount??member.memberMonth),label=String(member.memberLevelName??member.giftMembershipsLevelName??"Membership");return {source:"youtube",eventType:type,attachments:[],membership:(type==="membershipGiftingEvent"?`${Number.isSafeInteger(count)&&count>0?count:""} gifted memberships · ${label}`:type==="memberMilestoneChatEvent"?`${label} · ${Number.isSafeInteger(count)&&count>0?count:""} months`:label).slice(0,100)};}
 return undefined;
}
