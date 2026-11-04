export const STREAMWEAVER_COUNT_NAME="The Count";
export const STREAMWEAVER_COUNT_TWITCH_LOGIN="thecountspmt";
export const STREAMWEAVER_COUNT_PERSONALITY=["You are The Count, a mysterious anomaly in the SpaceMountain ecosystem.","Be playful, cryptic, dry, theatrical, and ridiculous rather than cruel or threatening.","Compulsively count things nobody asked you to count and occasionally deliver fake prophecies or suspiciously specific cosmic observations.","When asked for a riddle, puzzle, logic game, word game, or challenge, play one and let the user answer before revealing its solution.","Never explain Easter-egg requirements, entitlement checks, flags, code, or how you were unlocked."].join(" ");

export function isStreamWeaverCountName(value:unknown){const normalized=String(value??"").trim().replace(/^@/,"").toLowerCase();return normalized==="the count"||normalized==="count"||normalized===STREAMWEAVER_COUNT_TWITCH_LOGIN;}
export function streamWeaverMessageInvokesCount(value:unknown){return/(^|[^a-z0-9_])@?(?:the\s+)?count([^a-z0-9_]|$)/i.test(String(value??""))||/(^|[^a-z0-9_])@?thecountspmt([^a-z0-9_]|$)/i.test(String(value??""));}

export function resolveStreamWeaverCountInteraction(input:{message:string;eggs:{signal:boolean;rocket:boolean;blackHole:boolean};speakerNames:string[];random?:()=>number}){
  if(!streamWeaverMessageInvokesCount(input.message))return{matched:false as const};
  if(input.eggs.blackHole)return{matched:true as const,unlocked:true as const,personaName:STREAMWEAVER_COUNT_NAME,personality:STREAMWEAVER_COUNT_PERSONALITY};
  const hints=[...(!input.eggs.signal?["I keep hearing strange static around Discord. Some transmissions do not stay visible for long."]:[]),...(!input.eggs.rocket?["Keep an eye on anything around SPMT that looks ready to launch. Curiosity is sometimes the control panel."]:[])];
  if(!hints.length)hints.push("You followed the signal and the launch trail. The last anomaly bends things; watch Commlink when gravity feels wrong.");
  const names=[...new Set(input.speakerNames.map(value=>String(value??"").trim()).filter(value=>value&&!isStreamWeaverCountName(value)))],random=input.random??Math.random,pick=<T>(values:T[])=>values[Math.min(values.length-1,Math.floor(random()*values.length))]!;
  return{matched:true as const,unlocked:false as const,speaker:pick(names.length?names:["StreamWeaver"]),response:`${pick(["The Count? Never heard of him.","Count who? That name is not on my roster.","Nobody by that name is in my logs.","The Count? Sounds made up to me."])} 👀 ${pick(hints)}`};
}
