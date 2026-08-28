export type DshShoutoutGroupV1 = "crew"|"partners"|"honored guests"|"vip"|"community"|"raid train"|"raid pile";
export type DshGroupValueV1 = string|number|null|undefined;
export const DSH_SHOUTOUT_GROUPS:Readonly<Record<DshShoutoutGroupV1,{label:string;slug:string;description:string}>>=Object.freeze({
  crew:{label:"Crew",slug:"crew",description:"Community moderators and operators."},
  partners:{label:"Partners",slug:"partners",description:"Approved SPMT partners."},
  "honored guests":{label:"Honored Guests",slug:"honored-guests",description:"Special guests and featured community members."},
  vip:{label:"VIP",slug:"vip",description:"Most valued supporters."},
  community:{label:"Community",slug:"community",description:"General members of the community."},
  "raid train":{label:"Raid Train",slug:"raid-train",description:"Participants in scheduled raid trains."},
  "raid pile":{label:"Raid Pile",slug:"raid-pile",description:"Participants in spontaneous group raids."},
});
function normalizeText(value:string){return value.toLowerCase().trim().replace(/[_-]+/g," ").replace(/\s+/g," ");}
export function normalizeDshShoutoutGroup(value:DshGroupValueV1):DshShoutoutGroupV1|null{
  if(typeof value==="number"){if(value===0)return"vip";if(value===1)return"community";}
  if(typeof value!=="string")return null;const normalized=normalizeText(value);if(!normalized)return null;
  if(normalized.startsWith("crew"))return"crew";if(normalized.startsWith("partner"))return"partners";if(normalized.startsWith("honored guest"))return"honored guests";if(normalized.startsWith("vip"))return"vip";if(normalized.startsWith("community")||normalized.startsWith("everyone else")||normalized.startsWith("mountaineer"))return"community";if(normalized.startsWith("raid train")||normalized.startsWith("train"))return"raid train";if(normalized.startsWith("raid pile")||normalized.startsWith("pile"))return"raid pile";return null;
}
export function canonicalDshShoutoutGroup(value:DshGroupValueV1){const normalized=normalizeDshShoutoutGroup(value);return normalized?DSH_SHOUTOUT_GROUPS[normalized].label:typeof value==="string"?value:null;}
export function dshShoutoutGroupSlug(value:DshGroupValueV1){const normalized=normalizeDshShoutoutGroup(value);return normalized?DSH_SHOUTOUT_GROUPS[normalized].slug:null;}
export function dshShoutoutGroupFromSlug(slug:string|null|undefined){return canonicalDshShoutoutGroup(slug);}
export function matchesDshShoutoutGroup(value:DshGroupValueV1,target:DshGroupValueV1){const normalizedTarget=normalizeDshShoutoutGroup(target);return Boolean(normalizedTarget&&normalizeDshShoutoutGroup(value)===normalizedTarget);}
export interface DshShoutoutMemberV1 { userId:string; username:string; displayName?:string; group:DshGroupValueV1; isLive?:boolean; twitchLogin?:string; avatarUrl?:string }
export function listDshShoutoutGroupMembers(members:readonly DshShoutoutMemberV1[],group:DshGroupValueV1){const normalized=normalizeDshShoutoutGroup(group);if(!normalized)throw new Error("Unknown DSH shoutout group");return members.filter((member)=>matchesDshShoutoutGroup(member.group,normalized)).map((member)=>({...member,group:DSH_SHOUTOUT_GROUPS[normalized].label}));}
export function buildDshShoutoutGroupSummary(members:readonly DshShoutoutMemberV1[]){return(Object.keys(DSH_SHOUTOUT_GROUPS) as DshShoutoutGroupV1[]).map((group)=>({group,label:DSH_SHOUTOUT_GROUPS[group].label,slug:DSH_SHOUTOUT_GROUPS[group].slug,description:DSH_SHOUTOUT_GROUPS[group].description,memberCount:listDshShoutoutGroupMembers(members,group).length,liveCount:listDshShoutoutGroupMembers(members,group).filter((member)=>member.isLive).length}));}
export function resolveDshShoutoutTargets(members:readonly DshShoutoutMemberV1[],group:DshGroupValueV1,input:{liveOnly?:boolean}={}){const selected=listDshShoutoutGroupMembers(members,group);return selected.filter((member)=>!input.liveOnly||member.isLive).map((member)=>({userId:String(member.userId),username:String(member.username),displayName:String(member.displayName||member.username),twitchLogin:String(member.twitchLogin||member.username).toLowerCase(),group:String(member.group)}));}
