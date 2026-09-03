export interface QuackversePresentationCardV1 { id?: number|string; name:string; rarity?:string; type?:string; imageUrl?:string; cardImageUrl?:string; }
export interface QuackversePackPresentationInputV1 { packId:string; username:string; pack:QuackversePresentationCardV1[]; packsRemaining:number; collectionIds:number[]; gifUrl?:string; animationUnavailable?:boolean; }

export function buildQuackversePackDiscordPayload(input:QuackversePackPresentationInputV1){
  const packId=identifier(input.packId,"packId"),username=label(input.username||"player",80),pack=input.pack.slice(0,12).map(card),collectionIds=input.collectionIds.map(Number).filter(Number.isFinite),packsRemaining=Math.max(0,Math.trunc(Number(input.packsRemaining)||0)),gifUrl=input.gifUrl?safeHttps(input.gifUrl):undefined;
  if(!pack.length)throw new Error("Quackverse pack presentation requires cards");
  const packNames=pack.slice(0,5).map(item=>item.name).join(", "),packLines=pack.slice(0,5).map(item=>`${item.name} (${item.rarity||"Unknown"})`).join("\n"),rarities=new Map<string,number>();for(const item of pack)rarities.set(item.rarity||"Unknown",(rarities.get(item.rarity||"Unknown")??0)+1);
  const description=[`🦆 @${username} opened a Quackverse pack: ${packNames}. ${packsRemaining} packs left today.`,input.animationUnavailable?"🎞️ Pack animation unavailable for this opening.":gifUrl?"🎞️ Pack animation ready.":"🎞️ Pack animation rendering…"].join("\n");
  return{schemaVersion:1 as const,packId,content:"",embeds:[{title:"🦆 Quackverse Pack Opened",description,color:0x00d9ff,fields:[{name:"Pack",value:packLines,inline:false},{name:"Collection",value:`${collectionIds.length} total cards | ${new Set(collectionIds).size} unique`,inline:true},{name:"Rarity Breakdown",value:[...rarities].sort(([a],[b])=>a.localeCompare(b)).map(([rarity,count])=>`${rarity}: ${count}`).join(" | "),inline:false}],...(gifUrl?{image:{url:gifUrl}}:{}),footer:{text:"Nebula Arcade · Quackverse"},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[] as string[]}};
}

function card(value:QuackversePresentationCardV1){return{id:value.id,name:label(value.name||"Unknown Card",100),rarity:label(value.rarity||"Unknown",60),type:label(value.type||"Unknown",60),imageUrl:value.cardImageUrl||value.imageUrl?safeHttps(String(value.cardImageUrl||value.imageUrl)):undefined};}
function identifier(value:unknown,name:string){const result=String(value??"").trim().replace(/[^A-Za-z0-9._:-]+/g,"-").slice(0,120);if(!result)throw new Error(`Quackverse ${name} is invalid`);return result;}
function label(value:unknown,max:number){const result=String(value??"").replace(/\s+/g," ").trim().slice(0,max);if(!result)throw new Error("Quackverse presentation label is invalid");return result;}
function safeHttps(value:string){const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)throw new Error("Quackverse presentation media URL is invalid");return url.toString();}
