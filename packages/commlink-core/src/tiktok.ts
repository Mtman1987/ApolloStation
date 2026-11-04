import type {CommlinkTikTokEventV1,CommlinkLiveChatRecordV1} from "@spmt/contracts";
/** TikTok Webcast observations are public display data, never verified account identity. */
export function normalizeTikTokLiveEvent(input:CommlinkTikTokEventV1):CommlinkLiveChatRecordV1 {
  if(input.schemaVersion!==1||!["chat","gift","follow","share","like","viewers"].includes(input.kind))throw new Error("Invalid TikTok event");
  const clean=(v:unknown,max:number)=>{if(typeof v!=="string"||!v.trim()||v.length>max||v.includes("\0"))throw new Error("Invalid TikTok event field");return v.trim()};
  const occurredAt=clean(input.occurredAt,50);if(!Number.isFinite(Date.parse(occurredAt)))throw new Error("Invalid TikTok event time");
  for(const quantity of [input.diamondCost,input.totalLikes])if(quantity!==undefined&&(!Number.isSafeInteger(quantity)||quantity<0||quantity>1e12))throw new Error("Invalid TikTok event total");
  if(input.quantity!==undefined&&(!Number.isSafeInteger(input.quantity)||input.quantity<0||input.quantity>1e12))throw new Error("Invalid TikTok event quantity");
  return {schemaVersion:1,tenantId:clean(input.tenantId,200),provider:"tiktok",connectionId:clean(input.connectionId,200),channelId:clean(input.channelId,200),messageId:clean(input.messageId,200),occurredAt,text:clean(input.text,8000),providerUserId:clean(input.userId,200),username:clean(input.username,120),displayName:clean(input.displayName,120),isBot:false,roles:[],rich:{source:"tiktok",eventType:input.kind,attachments:[],...(input.kind==="gift"?{donation:input.text.slice(0,200)}:{})}};
}
