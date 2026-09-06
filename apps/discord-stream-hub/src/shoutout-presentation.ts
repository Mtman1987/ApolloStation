import { canonicalDshShoutoutGroup } from "./shoutout-groups.js";

export interface DshShoutoutView {
  id:string; twitchLogin:string; displayName:string; group:string; isSpotlight:boolean;
  title:string; gameName:string; viewerCount:number|null; description:string;
  avatarUrl?:string; imageUrl?:string; videoUrl?:string; bannerUrl?:string; sourceMessageUrl?:string;
  startedAt?:string; updatedAt?:string; partnerDiscordUrl?:string;
  generated?:{state:string;message?:string;error?:string};
}
export interface DshEmbedTemplates {
  crew:{title:string;description:string;badge:string;footer:string};
  partners:{title:string;description:string;badge:string;footer:string};
  community:{title:string;footer:string};
}
// Visual/content contract from DiscordStreamHub d97af86 src/lib/embed-templates.ts.
export const DSH_LIVE_EMBED_TEMPLATES:DshEmbedTemplates={
  crew:{title:'🎬 {username} is LIVE!',description:'🌟 **Space Mountain Crew Member** 🌟\n\nOne of our amazing crew members is live! They help keep Space Mountain running smoothly. Show them some love and join the stream!',badge:'Space Mountain Crew',footer:'Twitch • Space Mountain Crew Shoutout'},
  partners:{title:'⭐ {username} is LIVE!',description:"⭐ **Space Mountain Partner** ⭐\n\nOne of our official streaming partners is live! They're a valued member of the Space Mountain community. Show them some love and join the stream!",badge:'Official Space Mountain Partner',footer:'Twitch • Space Mountain Partner Shoutout'},
  community:{title:'🎬 {username} is LIVE!',footer:'Twitch • Mountaineer Shoutout'},
};
export function dshHttps(value:unknown):string|undefined {if(typeof value!=="string"||!value)return;try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}catch{}return;}
export function dshShoutoutView(value:unknown):DshShoutoutView|undefined{
  if(!value||typeof value!=="object")return;const row=value as Record<string,unknown>,login=String(row.twitchLogin??"").toLowerCase();
  if(row.isLive!==true||!/^\w{1,32}$/.test(login))return;
  const url=(name:string)=>{const value=dshHttps(row[name]);return value?{[name]:value}:{}};
  const date=(name:string)=>{const value=row[name];return typeof value==='string'&&Number.isFinite(Date.parse(value))?{[name]:new Date(value).toISOString()}:{}};
  return{id:String(row.id??`${login}:${row.startedAt??'live'}`).slice(0,200),twitchLogin:login,displayName:String(row.displayName??login).slice(0,100),group:canonicalDshShoutoutGroup(String(row.groupName??row.category??'Community'))??'Community',isSpotlight:row.isSpotlight===true,title:String(row.title??'').slice(0,200),gameName:String(row.gameName??'').slice(0,100),viewerCount:typeof row.viewerCount==='number'&&Number.isFinite(row.viewerCount)&&row.viewerCount>=0?Math.floor(row.viewerCount):null,description:String(row.description??'').slice(0,2000),...url('avatarUrl'),...url('imageUrl'),...url('videoUrl'),...url('bannerUrl'),...url('sourceMessageUrl'),...url('partnerDiscordUrl'),...date('startedAt'),...date('updatedAt')};
}

/** Preserve the donor's five live tiers; the app's generated copy does not rewrite these embeds. */
export function buildDshTierShoutout(view:DshShoutoutView,options:{templates?:DshEmbedTemplates;timestamp?:string;partnerDiscordUrl?:string}={}){
  const templates=options.templates??DSH_LIVE_EMBED_TEMPLATES,url=`https://twitch.tv/${view.twitchLogin}`,timestamp=options.timestamp??new Date().toISOString(),avatar=view.avatarUrl??'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png';
  const image=view.imageUrl,common={url,thumbnail:{url:avatar},...(image?{image:{url:image}}:{}),timestamp};
  if(view.group==='Crew'||view.group==='Partners'){
    const crew=view.group==='Crew',template=crew?templates.crew:templates.partners,color=crew?0x00D9FF:0x8B00FF;
    const embed={author:{name:template.title.replace('{username}',view.displayName),icon_url:'https://cdn.discordapp.com/emojis/1284931162896334929.gif',url},title:`${crew?'🚀':'🌌'} **${view.title}**`,description:template.description,...common,color,fields:[{name:'🎮 Playing',value:view.gameName||'No category',inline:true},{name:'👥 Viewers',value:view.viewerCount===null?'—':String(view.viewerCount),inline:true},{name:crew?'🚀 Crew Status':'🌟 Partner Status',value:template.badge,inline:true}],footer:{text:template.footer}};
    const discord=dshHttps(view.partnerDiscordUrl??options.partnerDiscordUrl);
    return{embeds:crew&&view.bannerUrl?[{image:{url:view.bannerUrl},color},embed]:[embed],...(!crew?{components:[{type:1,components:[{type:2,style:5,label:'Watch on Twitch',url,emoji:{name:'📺'}},...(discord?[{type:2,style:5,label:'Join Their Discord',url:discord,emoji:{name:'💬'}}]:[])]}]}:{}),allowed_mentions:{parse:[]}};
  }
  const honored=view.group==='Honored Guests',raid=view.group==='Raid Pile';
  return{embeds:[{title:honored||raid?`🚨 **${view.displayName}** is now LIVE on Twitch!`:templates.community.title.replace('{username}',view.displayName),description:`**${view.title}**\n🎮 Playing: ${view.gameName}\n👥 Viewers: ${view.viewerCount??'—'}${honored?'\n\n✨ *Honored Guest*':''}`,...common,color:honored?0xFF8C00:raid?0x4ECDC4:0x9146FF,footer:{text:honored?'Twitch • Honored Guest':raid?'Twitch • Raid Pile Shoutout 🎯':templates.community.footer}}],allowed_mentions:{parse:[]}};
}

export function dshStreamShoutout(member:import('./live-monitor.js').DshLiveMemberV1,stream:import('./live-monitor.js').DshTwitchStreamV1):DshShoutoutView {
  const imageUrl=dshHttps(stream.thumbnailUrl.replace('{width}','1920').replace('{height}','1080'));
  return {id:stream.twitchStreamId,twitchLogin:member.twitchLogin,displayName:stream.displayName,group:member.group,isSpotlight:false,title:stream.title,gameName:stream.gameName,viewerCount:stream.viewerCount,description:'',startedAt:stream.startedAt,...(imageUrl?{imageUrl}:{}),...(stream.avatarUrl?{avatarUrl:stream.avatarUrl}:{}),...(member.bannerUrl?{bannerUrl:member.bannerUrl}:{}),...(member.partnerDiscordUrl?{partnerDiscordUrl:member.partnerDiscordUrl}:{})};
}

export function dshEmbedTemplateOverrides(value:unknown):DshEmbedTemplates|undefined {
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('embedTemplates must contain crew, partners and community template fields');
  const templates=structuredClone(DSH_LIVE_EMBED_TEMPLATES);
  for(const [group,overrides] of Object.entries(value)){
    if(!Object.hasOwn(templates,group)||!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw new Error('Unknown embed template group');
    const target=templates[group as keyof DshEmbedTemplates] as Record<string,string>;
    for(const [field,text] of Object.entries(overrides)){
      const max=field==='description'?2000:field==='badge'?300:200;
      if(!Object.hasOwn(target,field)||typeof text!=='string'||!text.trim()||text.length>max||text.includes('\0'))throw new Error('Invalid embed template field');
      target[field]=text;
    }
  }
  return templates;
}
