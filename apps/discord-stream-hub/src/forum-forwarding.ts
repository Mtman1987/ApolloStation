import type { SpmtClient } from "@spmt/sdk";
export const DSH_FORUM_POST_FORWARDED="dsh.forum.post-forwarded.v1";
export interface DshForwardedForumPostV1 {
  sourceApp:string;sourceServerId:string;sourceChannelId:string;sourceChannelName:string;
  sourceMessageId:string;sourceMessageUrl?:string;authorId:string;authorName:string;
  title:string;content:string;category?:string;postedAt?:string;
  embeds?:Array<Record<string,unknown>>;attachments?:Array<Record<string,unknown>>;
  mentionedUsers?:Array<Record<string,unknown>>;
}
function forumText(value:unknown,max:number){const result=String(value??"").trim();if(!result||result.length>max||result.includes("\0"))throw new Error("Forwarded forum post contains invalid text");return result;}
function forumList(value:unknown,max:number){if(value===undefined||value===null)return[];if(!Array.isArray(value)||value.length>max)throw new Error("Forwarded forum post contains too many rich items");return value.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Forwarded forum rich item is invalid");const encoded=JSON.stringify(item);if(encoded.length>12000)throw new Error("Forwarded forum rich item is too large");return JSON.parse(encoded) as Record<string,unknown>;});}
export function normalizeDshForwardedForumPost(value:unknown):DshForwardedForumPostV1{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Forwarded forum post is required");
  const item=value as Record<string,unknown>,postedAt=item.postedAt===undefined?undefined:forumText(item.postedAt,60);
  if(postedAt&&!Number.isFinite(Date.parse(postedAt)))throw new Error("Forwarded forum post time is invalid");
  const sourceMessageUrl=item.sourceMessageUrl===undefined?undefined:forumText(item.sourceMessageUrl,2048);
  if(sourceMessageUrl){const url=new URL(sourceMessageUrl);if(url.protocol!=="https:")throw new Error("Forwarded forum source URL must use HTTPS");}
  return {sourceApp:forumText(item.sourceApp,80),sourceServerId:forumText(item.sourceServerId,120),sourceChannelId:forumText(item.sourceChannelId,120),sourceChannelName:forumText(item.sourceChannelName,120),sourceMessageId:forumText(item.sourceMessageId,120),...(sourceMessageUrl?{sourceMessageUrl}:{}),authorId:forumText(item.authorId,120),authorName:forumText(item.authorName,120),title:forumText(item.title,300),content:forumText(item.content,12000),...(item.category===undefined?{}:{category:forumText(item.category,100)}),...(postedAt?{postedAt}:{}),embeds:forumList(item.embeds,10),attachments:forumList(item.attachments,20),mentionedUsers:forumList(item.mentionedUsers,50)};
}
export async function forwardDshForumPost(client:SpmtClient,tenantId:string,value:unknown){
  const post=normalizeDshForwardedForumPost(value);
  const result=await client.publishEvent(tenantId,DSH_FORUM_POST_FORWARDED,{schemaVersion:1,...post,forwardedAt:new Date().toISOString()},`dsh-forum:${post.sourceApp}:${post.sourceServerId}:${post.sourceChannelId}:${post.sourceMessageId}`);
  return {accepted:true,duplicate:result.duplicate,event:result.event};
}
