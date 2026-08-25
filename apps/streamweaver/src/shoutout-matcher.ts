export interface StreamWeaverShoutoutAiMatcherV1 {
  match(input:{tenantId:string;spokenName:string;candidates:string[]}):Promise<string|undefined>|string|undefined;
}

export function extractStreamWeaverShoutoutRequestTarget(message:string):string|undefined{
  const input=String(message??"").trim(); if(!input)return undefined;
  const wakeWordStripped=input.replace(/^(?:athena|@[a-z0-9_]+)[,\s]+/i,"");
  const target="(@?[a-z0-9_]{2,25})";
  const patterns=[
    new RegExp(`^(?:please\\s+)?(?:shout\\s*out|shoutout)\\s+(?:(?:to|for)\\s+)?${target}\\b`,"i"),
    new RegExp(`^(?:please\\s+)?(?:give|do|send|run|trigger|play|make)\\s+(?:a\\s+)?(?:shout\\s*out|shoutout)\\s+(?:(?:to|for)\\s+)?${target}\\b`,"i"),
    new RegExp(`^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:give\\s+)?(?:a\\s+)?(?:shout\\s*out|shoutout)\\s+(?:(?:to|for)\\s+)?${target}\\b`,"i"),
  ];
  for(const pattern of patterns){const match=wakeWordStripped.match(pattern);if(match?.[1])return normalize(match[1]);}
  return undefined;
}

export function scoreStreamWeaverShoutoutMatch(spokenName:string,candidate:string):number{
  const spoken=normalize(spokenName); const target=normalize(candidate); if(!spoken||!target)return 0;
  if(spoken===target)return 1000;
  if(target.includes(spoken)||spoken.includes(target))return 750;
  let sharedPrefix=0; while(sharedPrefix<spoken.length&&sharedPrefix<target.length&&spoken[sharedPrefix]===target[sharedPrefix])sharedPrefix+=1;
  if(sharedPrefix>0)return 300+sharedPrefix;
  let overlap=0; for(const char of new Set(spoken)){if(target.includes(char))overlap+=1;}
  return overlap*10;
}

export function pickLocalStreamWeaverShoutoutMatch(spokenName:string,candidates:readonly string[]):string|undefined{
  const scored=candidates.map(candidate=>({candidate:safeLogin(candidate),score:scoreStreamWeaverShoutoutMatch(spokenName,candidate)})).filter(entry=>entry.candidate&&entry.score>0).sort((a,b)=>b.score-a.score||a.candidate.localeCompare(b.candidate));
  const first=scored[0]; if(!first)return undefined;
  if(scored[1]&&scored[1].score===first.score)return undefined;
  return first.candidate;
}

export async function matchStreamWeaverShoutoutTarget(input:{tenantId:string;spokenName:string;candidates:readonly string[];ai?:StreamWeaverShoutoutAiMatcherV1}):Promise<string|undefined>{
  const candidates=[...new Set(input.candidates.map(safeLogin).filter(Boolean))]; if(!candidates.length)return undefined;
  const local=pickLocalStreamWeaverShoutoutMatch(input.spokenName,candidates); if(local)return local;
  if(input.ai){
    try{
      const response=await input.ai.match({tenantId:safeId(input.tenantId),spokenName:String(input.spokenName??"").slice(0,120),candidates});
      const normalized=safeLogin(response??""); if(normalized&&candidates.includes(normalized))return normalized;
    }catch{/* donor behavior falls back locally when AI match fails */}
  }
  return pickLocalStreamWeaverShoutoutMatch(input.spokenName,candidates);
}

function normalize(value:unknown):string{return String(value??"").trim().toLowerCase().replace(/^@/,"").replace(/[^a-z0-9_]+/g,"").slice(0,25);}
function safeLogin(value:unknown):string{const result=normalize(value);return /^[a-z0-9_]{1,25}$/.test(result)?result:"";}
function safeId(value:unknown):string{const result=String(value??"").trim().replace(/[^A-Za-z0-9._:-]/g,"").slice(0,180);if(!result)throw new Error("tenantId is required");return result;}
