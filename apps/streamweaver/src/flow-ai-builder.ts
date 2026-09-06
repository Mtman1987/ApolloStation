import { DEVICE_AUTOMATION_ACTIONS, SPMT_SUITE_ACTION_CATALOG } from "@spmt/contracts";
import { STREAMWEAVER_DONOR_COMMANDS } from "./donor-command-catalog.js";

export interface StreamWeaverAiFlowPromptContextV1 {
  devices?: unknown[];
  connections?: unknown[];
}

/** Apollo's registered StreamWeaver tools are the authoring truth. Live StreamWeaver is reference material only. */
export function buildStreamWeaverAiFlowPrompt(idea: string, context: StreamWeaverAiFlowPromptContextV1 = {}) {
  const suite = SPMT_SUITE_ACTION_CATALOG.map((item) => `${item.id}[${item.minimumRole}/${item.risk}]`).join(",");
  const native = STREAMWEAVER_DONOR_COMMANDS.filter(item=>item.donorId!=="secure-choice-session").map((item) => `${item.donorId}=${item.trigger}`).join(",");
  const deviceActions = Object.entries(DEVICE_AUTOMATION_ACTIONS).map(([action, capability]) => `${action}:${capability}`).join(",");
  const devices = context.devices?.slice(0, 40).flatMap((value) => {
    const item = record(value), id = clean(item?.deviceId);
    return id ? [`${id}:${clean(item?.kind) || "device"}:${list(item?.capabilities).join("+")}`] : [];
  }).join(",") || "none";
  const connections = context.connections?.slice(0, 40).flatMap((value) => {
    const item = record(value), id = clean(item?.connectionId), provider = clean(item?.provider), channel = clean(item?.channelId);
    return id && provider ? [`${provider}:${id}:${channel}`] : [];
  }).join(",") || "none";

  const prompt = [
    "You are Stellar Core's StreamWeaver command-flow coder. ApolloStation contracts below are the source of truth; old/live StreamWeaver is behavior reference only.",
    "Return one strict JSON object only: one uninstalled private reviewable flow package, never markdown or an unrelated library.",
    "Root: schemaVersion=1 kind=streamweaver.flow-package installUnit=flow packageKind=command_flow visibility=private plus packageId,name,description,collection,tags,commands,actions.",
    "Exactly one command is role=primary required=true. Commands need id,trigger,aliases,role,required,actionIds,family=custom,cooldownSeconds,matcher(command|regex|bare),runtime=flow,enabled=true; optional minimumRole,caseSensitive,globalCooldownSeconds,edges.",
    "Actions: send-chat{text}; send-discord{text,connectionId?,channelId?}; wait{milliseconds}; run-action{action,args,saveAs?,sendResult?}; run-native{donorId plus capability-specific config}; set-variable{key,value,scope}; condition{left,operator,right}; ai-response{input,saveAs?}; obs-scene{deviceId,sceneName}; obs-source{deviceId,sceneName,sourceName,visible}; device-command{deviceId,action,payload}. Never emit http-request or execute-code.",
    "SECURE SIMULTANEOUS CHOICE: use run-native donorId=secure-choice-session when two linked users must choose privately before reveal. Config also needs title,target=first-mention,expiresSeconds(30..900),options=[{id,label}] 2..12,relations=[{winner,loser,message}]. Relations must resolve every unordered pair exactly once. The runtime creates an accept link, identity-locks each seat, independently shuffles each player's numbered grid, commits choices without reveal, reveals only after both commit, retries ties with fresh grids, and posts the result back to the source channel. Do not create your own URLs, tokens, whispers, or reveal protocol.",
    "Graph: condition requires edges {source,target,outcome:true|false}; normal edges may use success. No cycles/dangling/orphan actions. Ordered flows may omit edges. First actionId is the entry step.",
    "Templates: %userName% %user% %message% %rawInput% %args% %targetUser% {{args.0}} {{vars.name}} {{name}}. saveAs outputs feed later steps.",
    "Flow Code is the safe pure gap filler inside string fields: {{= argsText | trim | upper }}. Sources message,argsText,userName,user,targetUser,lastOutput,args[n],argN,vars.name,literals. Ops trim,lower,upper,string,number,length,add,subtract,multiply,divide,mod,abs,round,floor,ceil,min,max,contains,startsWith,endsWith,replace,slice,split,join,pick,default,json. No network/files/secrets/eval/JS.",
    "Prefer registered native/run-action/device/AI tools over Flow Code. Never invent tool IDs, devices, connections, secrets, provider APIs or hidden routes. If capability is missing, build the supported portion and say what setup is missing in description.",
    `Suite actions: ${suite}`,
    `Native commands: ${native}`,
    `Device actions: ${deviceActions}`,
    `Paired devices: ${devices}`,
    `Chat connections: ${connections}`,
    `User request: ${idea}`,
  ].join("\n");
  if (prompt.length > 8_000) throw new Error("Flow builder request is too large for Stellar; shorten the command description");
  return prompt;
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function clean(value: unknown) { return typeof value === "string" ? value.replace(/[\r\n\0,:+]/g, "").trim().slice(0, 160) : ""; }
function list(value: unknown) { return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [clean(item)] : []).filter(Boolean).slice(0, 20) : []; }
