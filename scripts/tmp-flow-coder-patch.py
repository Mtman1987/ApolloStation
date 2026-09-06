from __future__ import annotations

from pathlib import Path
import re
import textwrap

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    if old not in source:
        raise RuntimeError(f"expected text not found in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


def regex_once(path: str, pattern: str, replacement: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex match in {path}, got {count}: {pattern}")
    target.write_text(updated, encoding="utf-8")


write(
    "apps/streamweaver/src/flow-code.ts",
    r'''
    export interface StreamWeaverFlowCodeContextV1 {
      message: string;
      args: string[];
      userName: string;
      user: string;
      targetUser: string;
      lastOutput: string;
      vars: Record<string, string>;
    }

    type FlowCodeValue = string | number | boolean | null | FlowCodeValue[];
    interface Stage { name: string; args: string[]; }

    const MAX_EXPRESSION_LENGTH = 4_000;
    const MAX_STAGES = 32;
    const MAX_ARGUMENTS = 16;
    const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
    const OPERATIONS = new Set([
      "trim", "lower", "upper", "string", "number", "length", "add", "subtract", "multiply", "divide", "mod",
      "abs", "round", "floor", "ceil", "min", "max", "contains", "startsWith", "endsWith", "replace", "slice",
      "split", "join", "pick", "default", "json",
    ]);

    /**
     * Flow Code is intentionally not JavaScript. It is a deterministic, side-effect-free
     * value pipeline used inside normal StreamWeaver templates: {{= argsText | trim | upper }}.
     * It cannot access network, files, credentials, globals, prototypes, eval, or arbitrary functions.
     */
    export function renderFlowCodeExpression(source: string, context: StreamWeaverFlowCodeContextV1): string {
      const pipeline = parsePipeline(source);
      let value = resolveAtom(pipeline.source, context);
      for (const stage of pipeline.stages) value = applyStage(stage, value, context);
      return output(value);
    }

    export function assertFlowCodeValue(value: unknown): void {
      if (typeof value === "string") {
        for (const match of value.matchAll(/\{\{\s*=\s*([^{}]+?)\s*\}\}/g)) parsePipeline(match[1] ?? "");
        return;
      }
      if (Array.isArray(value)) { for (const item of value) assertFlowCodeValue(item); return; }
      if (!value || typeof value !== "object") return;
      for (const item of Object.values(value as Record<string, unknown>)) assertFlowCodeValue(item);
    }

    function parsePipeline(source: string): { source: string; stages: Stage[] } {
      const expression = source.trim();
      if (!expression || expression.length > MAX_EXPRESSION_LENGTH || /[\r\n\0]/.test(expression)) throw new Error("Flow Code must be one expression up to 4000 characters");
      const parts = splitTopLevel(expression, "|");
      if (!parts.length || parts.length > MAX_STAGES + 1) throw new Error("Flow Code has too many pipeline stages");
      validateAtom(parts[0]!);
      const stages = parts.slice(1).map(parseStage);
      return { source: parts[0]!, stages };
    }

    function parseStage(source: string): Stage {
      const text = source.trim(), match = /^([A-Za-z][A-Za-z0-9]*)(?:\((.*)\))?$/.exec(text);
      if (!match || !OPERATIONS.has(match[1]!)) throw new Error(`Unsupported Flow Code operation: ${text.slice(0, 80)}`);
      const args = match[2] === undefined || !match[2].trim() ? [] : splitTopLevel(match[2], ",");
      if (args.length > MAX_ARGUMENTS) throw new Error("Flow Code operation has too many arguments");
      for (const arg of args) validateAtom(arg);
      validateArity(match[1]!, args.length);
      return { name: match[1]!, args };
    }

    function validateArity(name: string, count: number) {
      const exact: Record<string, number> = { trim:0, lower:0, upper:0, string:0, number:0, length:0, abs:0, round:0, floor:0, ceil:0, json:0 };
      if (Object.hasOwn(exact, name) && count !== exact[name]) throw new Error(`${name}() does not take arguments`);
      if (["add","subtract","multiply","divide","mod","contains","startsWith","endsWith","split","join","pick","default"].includes(name) && count !== 1) throw new Error(`${name}() requires one argument`);
      if (name === "replace" && count !== 2) throw new Error("replace() requires search and replacement arguments");
      if (name === "slice" && (count < 1 || count > 2)) throw new Error("slice() requires start and optional end arguments");
      if ((name === "min" || name === "max") && count < 1) throw new Error(`${name}() requires at least one comparison value`);
    }

    function validateAtom(source: string): void {
      const atom = source.trim();
      if (!atom) throw new Error("Flow Code contains an empty value");
      if (isQuoted(atom) || /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(atom) || /^(?:true|false|null)$/.test(atom)) return;
      if (["message","argsText","userName","user","targetUser","lastOutput"].includes(atom)) return;
      if (/^args\[\d{1,3}\]$/.test(atom) || /^arg\d{1,3}$/.test(atom)) return;
      const variable = /^vars\.([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(atom);
      if (variable && SAFE_NAME.test(variable[1]!)) return;
      throw new Error(`Unsupported Flow Code value: ${atom.slice(0, 80)}`);
    }

    function resolveAtom(source: string, context: StreamWeaverFlowCodeContextV1): FlowCodeValue {
      const atom = source.trim();
      if (isQuoted(atom)) return quoted(atom);
      if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(atom)) return Number(atom);
      if (atom === "true") return true;
      if (atom === "false") return false;
      if (atom === "null") return null;
      if (atom === "message") return context.message;
      if (atom === "argsText") return context.args.join(" ");
      if (atom === "userName") return context.userName;
      if (atom === "user") return context.user;
      if (atom === "targetUser") return context.targetUser;
      if (atom === "lastOutput") return context.lastOutput;
      const arg = /^args\[(\d{1,3})\]$/.exec(atom) ?? /^arg(\d{1,3})$/.exec(atom);
      if (arg) return context.args[Number(arg[1])] ?? "";
      const variable = /^vars\.([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(atom);
      if (variable) return Object.hasOwn(context.vars, variable[1]!) ? context.vars[variable[1]!] ?? "" : "";
      throw new Error("Flow Code value is unavailable");
    }

    function applyStage(stage: Stage, current: FlowCodeValue, context: StreamWeaverFlowCodeContextV1): FlowCodeValue {
      const args = stage.args.map((arg) => resolveAtom(arg, context));
      switch (stage.name) {
        case "trim": return text(current).trim();
        case "lower": return text(current).toLowerCase();
        case "upper": return text(current).toUpperCase();
        case "string": return text(current);
        case "number": return number(current);
        case "length": return Array.isArray(current) ? current.length : text(current).length;
        case "add": return number(current) + number(args[0]);
        case "subtract": return number(current) - number(args[0]);
        case "multiply": return number(current) * number(args[0]);
        case "divide": { const divisor = number(args[0]); if (divisor === 0) throw new Error("Flow Code cannot divide by zero"); return number(current) / divisor; }
        case "mod": { const divisor = number(args[0]); if (divisor === 0) throw new Error("Flow Code cannot divide by zero"); return number(current) % divisor; }
        case "abs": return Math.abs(number(current));
        case "round": return Math.round(number(current));
        case "floor": return Math.floor(number(current));
        case "ceil": return Math.ceil(number(current));
        case "min": return Math.min(number(current), ...args.map(number));
        case "max": return Math.max(number(current), ...args.map(number));
        case "contains": return text(current).includes(text(args[0]));
        case "startsWith": return text(current).startsWith(text(args[0]));
        case "endsWith": return text(current).endsWith(text(args[0]));
        case "replace": return text(current).replaceAll(text(args[0]), text(args[1]));
        case "slice": return (Array.isArray(current) ? current : text(current)).slice(integer(args[0]), args.length > 1 ? integer(args[1]) : undefined) as FlowCodeValue;
        case "split": return text(current).split(text(args[0])).slice(0, 256);
        case "join": return Array.isArray(current) ? current.map(text).join(text(args[0])) : text(current);
        case "pick": return Array.isArray(current) ? current[integer(args[0])] ?? "" : text(current).charAt(integer(args[0]));
        case "default": return current === null || current === "" ? args[0] ?? "" : current;
        case "json": return JSON.stringify(current);
        default: throw new Error("Unsupported Flow Code operation");
      }
    }

    function splitTopLevel(source: string, delimiter: "|" | ","): string[] {
      const result: string[] = [];
      let start = 0, quote = "", escaped = false, depth = 0;
      for (let index = 0; index < source.length; index += 1) {
        const char = source[index]!;
        if (quote) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === quote) quote = "";
          continue;
        }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === "(") { depth += 1; continue; }
        if (char === ")") { depth -= 1; if (depth < 0) throw new Error("Flow Code has an unmatched parenthesis"); continue; }
        if (char === delimiter && depth === 0) { result.push(source.slice(start, index).trim()); start = index + 1; }
      }
      if (quote || depth !== 0) throw new Error("Flow Code has an unterminated string or parenthesis");
      result.push(source.slice(start).trim());
      return result;
    }

    function isQuoted(value: string) { return value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")); }
    function quoted(value: string) {
      const body = value.slice(1, -1);
      if (value[0] === '"') { try { return JSON.parse(value) as string; } catch { throw new Error("Flow Code string literal is invalid"); } }
      return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    }
    function text(value: FlowCodeValue | undefined): string { if (value === null || value === undefined) return ""; return Array.isArray(value) ? value.map(text).join(",") : String(value); }
    function number(value: FlowCodeValue | undefined): number { const result = Number(Array.isArray(value) ? text(value) : value); if (!Number.isFinite(result)) throw new Error("Flow Code expected a finite number"); return result; }
    function integer(value: FlowCodeValue | undefined): number { const result = number(value); if (!Number.isSafeInteger(result)) throw new Error("Flow Code expected an integer"); return result; }
    function output(value: FlowCodeValue): string { return Array.isArray(value) ? JSON.stringify(value) : value === null ? "" : String(value); }
    ''',
)

write(
    "apps/streamweaver/src/flow-ai-builder.ts",
    r'''
    import { DEVICE_AUTOMATION_ACTIONS, SPMT_SUITE_ACTION_CATALOG } from "@spmt/contracts";
    import { STREAMWEAVER_DONOR_COMMANDS } from "./donor-command-catalog.js";

    export interface StreamWeaverAiFlowPromptContextV1 {
      devices?: unknown[];
      connections?: unknown[];
    }

    /**
     * Compile the current Apollo StreamWeaver capability catalogs into the developer prompt sent to Stellar Core.
     * Live StreamWeaver is intentionally not consulted here: Apollo's registered tools are the execution truth.
     */
    export function buildStreamWeaverAiFlowPrompt(idea: string, context: StreamWeaverAiFlowPromptContextV1 = {}) {
      const suite = SPMT_SUITE_ACTION_CATALOG.map((item) => `${item.id}[${item.minimumRole}/${item.risk}]`).join(",");
      const native = STREAMWEAVER_DONOR_COMMANDS.map((item) => `${item.donorId}=${item.trigger}`).join(",");
      const deviceActions = Object.entries(DEVICE_AUTOMATION_ACTIONS).map(([action, capability]) => `${action}:${capability}`).join(",");
      const devices = context.devices?.slice(0, 40).flatMap((value) => { const item = record(value); const id = clean(item?.deviceId); return id ? [`${id}:${clean(item?.kind) || "device"}:${list(item?.capabilities).join("+")}`] : []; }).join(",") || "none";
      const connections = context.connections?.slice(0, 40).flatMap((value) => { const item = record(value); const id = clean(item?.connectionId), provider = clean(item?.provider), channel = clean(item?.channelId); return id && provider ? [`${provider}:${id}:${channel}`] : []; }).join(",") || "none";
      const prompt = [
        "You are Stellar Core's StreamWeaver command-flow coder. ApolloStation StreamWeaver contracts below are the source of truth; the old live StreamWeaver is behavior reference only.",
        "Return exactly one strict JSON object and no markdown/explanation. It must be one uninstalled private reviewable flow package, not a library.",
        "ROOT schemaVersion=1; kind=streamweaver.flow-package; installUnit=flow; packageKind=command_flow; visibility=private; packageId,name,description,collection,tags,commands[],actions[].",
        "COMMAND exactly one role=primary required=true. Add-ons role=addon. Each: id,trigger,aliases,role,required,actionIds,family=custom,cooldownSeconds,matcher=command|regex|bare,runtime=flow,enabled=true; optional minimumRole,caseSensitive,globalCooldownSeconds,edges.",
        "ACTIONS each id,type,enabled=true,config. Supported: send-chat{text}; send-discord{text,connectionId?,channelId?}; wait{milliseconds 0..60000}; run-action{action,args,saveAs?,sendResult?}; run-native{donorId}; set-variable{key,value,scope=run|persistent}; condition{left,operator,right}; ai-response{input,saveAs?}; obs-scene{deviceId,sceneName}; obs-source{deviceId,sceneName,sourceName,visible}; device-command{deviceId,action,payload}. Never emit http-request or execute-code.",
        "GRAPH ordered flows may omit edges. Any condition requires edges. edges are {source,target,outcome?}; condition outcomes true/false, normal outcome success. No cycles, dangling IDs, or orphan actions. Every command starts at its first actionId.",
        "TEMPLATES: %userName%,%user%,%message%,%rawInput%,%args%,%targetUser%,{{args.0}},{{tags.display-name}},{{vars.name}},{{name}}. Results can saveAs and later use {{name}}.",
        "FLOW CODE: for pure missing transform/math logic use a normal string template with {{= pipeline }} (usually set-variable.value), never arbitrary JS. Sources message,argsText,userName,user,targetUser,lastOutput,args[n],argN,vars.name,literals. Ops trim,lower,upper,string,number,length,add,subtract,multiply,divide,mod,abs,round,floor,ceil,min,max,contains,startsWith,endsWith,replace,slice,split,join,pick,default,json. Example {{= argsText | trim | upper }}. It has no network/files/secrets/eval.",
        "RULES prefer registered native/run-action/device/AI steps over Flow Code; use Flow Code only for pure value gaps. Never invent tool IDs, devices, connections, secrets, provider APIs, or hidden routes. If a requested external capability is not registered, build the useful supported portion and state the missing setup in description rather than faking execution. Use actual paired device IDs when device work is requested.",
        `SUITE ACTIONS ${suite}`,
        `NATIVE COMMANDS ${native}`,
        `DEVICE ACTIONS ${deviceActions}`,
        `PAIRED DEVICES ${devices}`,
        `CHAT CONNECTIONS ${connections}`,
        `USER REQUEST ${idea}`,
      ].join("\n");
      if (prompt.length > 8_000) throw new Error("Flow builder request is too large for the Stellar developer channel; shorten the command description");
      return prompt;
    }

    function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
    function clean(value: unknown) { return typeof value === "string" ? value.replace(/[\r\n\0,:+]/g, "").trim().slice(0, 160) : ""; }
    function list(value: unknown) { return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [clean(item)] : []).filter(Boolean).slice(0, 20) : []; }
    ''',
)

replace_once(
    "apps/streamweaver/src/flow-runtime.ts",
    'import { assertStreamWeaverFlowRunnable, StreamWeaverFlowPackageStore, type StreamWeaverFlowActionV1, type StreamWeaverFlowPackageV1, type StreamWeaverFlowCommandV1 } from "./flow-packages.js";\n',
    'import { assertStreamWeaverFlowRunnable, StreamWeaverFlowPackageStore, type StreamWeaverFlowActionV1, type StreamWeaverFlowPackageV1, type StreamWeaverFlowCommandV1 } from "./flow-packages.js";\nimport { renderFlowCodeExpression } from "./flow-code.js";\n',
)

regex_once(
    "apps/streamweaver/src/flow-runtime.ts",
    r'export function renderFlowTemplate\(value:string,message:NormalizedChatMessageV1,variables:Record<string,string>\)\{.*?\n\}\nfunction actorRole',
    r'''export function renderFlowTemplate(value:string,message:NormalizedChatMessageV1,variables:Record<string,string>){
  const args=message.text.trim().split(/\s+/).slice(1),tags:Record<string,string>={"display-name":message.actor.displayName??message.actor.username,username:message.actor.username,"user-id":message.actor.canonicalUserId??message.actor.providerUserId};
  return value.replaceAll("%userName%",tags["display-name"]!).replaceAll("%user%",message.actor.username).replaceAll("%message%",message.text).replaceAll("%rawInput%",message.text).replaceAll("%args%",args.join(" ")).replaceAll("%targetUser%",message.mentions[0]?.username??"").replace(/\{\{\s*([^}]+?)\s*\}\}/g,(_,rawToken:string)=>{
    const token=rawToken.trim();
    if(token.startsWith("="))return renderFlowCodeExpression(token.slice(1),{message:message.text,args,userName:tags["display-name"]!,user:message.actor.username,targetUser:message.mentions[0]?.username??"",lastOutput:variables.lastOutput??"",vars:variables});
    const path=token.replace(/\[['"]?([^\]'" ]+)['"]?\]/g,".$1").split(".");
    if(path[0]==="args")return path.length===1?args.join(" "):args[Number(path[1])]??"";
    if(path[0]==="tags")return tags[path[1]!]??"";
    if(path[0]==="vars")return Object.hasOwn(variables,path[1]!)?variables[path[1]!]??"":"";
    return Object.hasOwn(variables,token)?variables[token]??"":"";
  }).slice(0,16000);
}
function actorRole''',
)

replace_once(
    "apps/streamweaver/src/flow-packages.ts",
    'import { STREAMWEAVER_DONOR_COMMANDS, type StreamWeaverDonorCommandFamilyV1, type StreamWeaverDonorCommandV1 } from "./donor-command-catalog.js";\n',
    'import { STREAMWEAVER_DONOR_COMMANDS, type StreamWeaverDonorCommandFamilyV1, type StreamWeaverDonorCommandV1 } from "./donor-command-catalog.js";\nimport { assertFlowCodeValue } from "./flow-code.js";\n',
)
replace_once(
    "apps/streamweaver/src/flow-packages.ts",
    '  for (const action of item.actions) {\n    if(!action.enabled||!item.commands.some(command=>command.enabled&&command.actionIds.includes(action.id)))continue;\n',
    '  for (const action of item.actions) {\n    assertFlowCodeValue(action.config);\n    if(!action.enabled||!item.commands.some(command=>command.enabled&&command.actionIds.includes(action.id)))continue;\n',
)

replace_once(
    "apps/streamweaver/src/web-controls.ts",
    'import { StreamWeaverFlowPackageStore, normalizeFlowPackage } from "./flow-packages.js";\n',
    'import { StreamWeaverFlowPackageStore, assertStreamWeaverFlowRunnable, normalizeFlowPackage } from "./flow-packages.js";\nimport { buildStreamWeaverAiFlowPrompt } from "./flow-ai-builder.js";\n',
)
replace_once(
    "apps/streamweaver/src/web-controls.ts",
    '      if (url.pathname === "/api/streamweaver/control/flows/ai") return await this.requestAiFlow(response, context, body);\n',
    '      if (url.pathname === "/api/streamweaver/control/flows/ai") return await this.requestAiFlow(request, response, context, body);\n',
)
regex_once(
    "apps/streamweaver/src/web-controls.ts",
    r'  private async requestAiFlow\(response: ServerResponse, context: SessionContext, body: Record<string, unknown>\) \{.*?\n  \}\n\n  private async completeAiFlow',
    r'''  private async requestAiFlow(request: IncomingMessage, response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    if (this.operationMode === "read-only") return sendJson(response, 200, { schemaVersion: 1, status: "blocked", reason: "Live-read mode accepts incoming data but does not send an AI request." });
    const idea=text(body.idea,"idea",4_000),client=this.requireClient(),userId=String(context.session.actorId??"");
    let devices:unknown[]=[];
    try{const value=await this.deviceApi(request,context);if(Array.isArray(value))devices=value;}catch{/* Device setup is optional; the coder is told no paired device is available. */}
    const connections=(this.options.connections??[]).filter(item=>item.tenantId===context.tenantId&&item.desired);
    const prompt=buildStreamWeaverAiFlowPrompt(idea,{devices,connections});
    const result=await client.invokeCommunityAssistant(context.tenantId,{userId,message:prompt,surface:"developer",conversationId:`streamweaver:flow-coder:${userId}`,routingPreference:"automatic",remember:false},idempotency(body.idempotencyKey,"streamweaver-flow-ai"));
    return sendJson(response,result.status==="accepted"?202:503,{...result,kind:"flow-builder",toolCatalog:"apollo-streamweaver"});
  }

  private async completeAiFlow''',
)
replace_once(
    "apps/streamweaver/src/web-controls.ts",
    '    const normalized=normalizeFlowPackage(candidate,{now:new Date().toISOString(),author:this.actor(context),visibility:"private"});\n    const saved=this.requireFlows().saveDraft(context.tenantId,normalized,this.actor(context));\n',
    '    const normalized=normalizeFlowPackage(candidate,{now:new Date().toISOString(),author:this.actor(context),visibility:"private"});\n    assertStreamWeaverFlowRunnable(normalized);\n    const saved=this.requireFlows().saveDraft(context.tenantId,normalized,this.actor(context));\n',
)

replace_once(
    "apps/streamweaver/src/web-client.ts",
    "Use %userName%, %targetUser%, %args% or %message% in replies. Use {{valueName}} for a value set by an earlier step.",
    "Use %userName%, %targetUser%, %args% or %message% in replies. Use {{valueName}} for a value set by an earlier step. Safe Flow Code can transform values with {{= argsText | trim | upper }}.",
)

write(
    "tests/streamweaver-flow-code.test.mjs",
    r'''
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import {assertFlowCodeValue,renderFlowCodeExpression} from '../apps/streamweaver/dist/flow-code.js';
    import {renderFlowTemplate} from '../apps/streamweaver/dist/flow-runtime.js';

    const context={message:'!shape  42, hello ',args:['42,','hello'],userName:'Commander',user:'commander',targetUser:'captain',lastOutput:'previous',vars:{count:'5',fallback:''}};

    test('Flow Code provides deterministic pure transforms and math without JavaScript execution',()=>{
      assert.equal(renderFlowCodeExpression('argsText | trim | upper',context),'42, HELLO');
      assert.equal(renderFlowCodeExpression('vars.count | number | add(2) | multiply(3)',context),'21');
      assert.equal(renderFlowCodeExpression('"alpha,beta,gamma" | split(",") | pick(1) | upper',context),'BETA');
      assert.equal(renderFlowCodeExpression('vars.fallback | default("ready")',context),'ready');
      assert.equal(renderFlowCodeExpression('targetUser | startsWith("cap")',context),'true');
    });

    test('Flow Code rejects arbitrary functions, prototype access and malformed pipelines',()=>{
      for(const source of ['argsText | eval("1+1")','vars.constructor','globalThis','argsText | replace("a")','argsText | upper |']) assert.throws(()=>renderFlowCodeExpression(source,context),/Flow Code|Unsupported|requires|empty/i);
      assert.throws(()=>assertFlowCodeValue({value:'{{= argsText | fetch("https://example.com") }}'}),/Unsupported Flow Code operation/);
      assert.doesNotThrow(()=>assertFlowCodeValue({value:'{{= vars.count | number | add(1) }}'}));
    });

    test('normal StreamWeaver templates can embed Flow Code expressions',()=>{
      const message={schemaVersion:1,tenantId:'tenant',provider:'twitch',connectionId:'main',channelId:'chat',messageId:'one',text:'!shape hello world',occurredAt:'2026-09-06T00:00:00Z',actor:{providerUserId:'one',username:'commander',displayName:'Commander',isBot:false,roles:['broadcaster']},mentions:[]};
      assert.equal(renderFlowTemplate('Result: {{= argsText | upper }}',message,{lastOutput:''}),'Result: HELLO WORLD');
      assert.equal(renderFlowTemplate('{{= vars.points | number | add(args[0]) }}',message,{points:'4'}),'4');
    });
    ''',
)

write(
    "tests/streamweaver-flow-ai-builder.test.mjs",
    r'''
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import {buildStreamWeaverAiFlowPrompt} from '../apps/streamweaver/dist/flow-ai-builder.js';

    test('Stellar flow-coder prompt is sourced from Apollo tools and teaches branches, AI, devices and Flow Code',()=>{
      const prompt=buildStreamWeaverAiFlowPrompt('make a smart command',{devices:[{deviceId:'companion-main',kind:'companion',capabilities:['obs.scene','media.playback']}],connections:[{provider:'discord',connectionId:'discord-main',channelId:'chat'}]});
      for(const value of ['condition{left,operator,right}','ai-response{input,saveAs?}','obs-source{deviceId,sceneName,sourceName,visible}','hmo.media.request','dsh.shoutouts.post','sw.image.generate','clip=!clip','media.volume.set:media.playback','companion-main:companion','discord:discord-main:chat','{{= argsText | trim | upper }}']) assert.match(prompt,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      assert.match(prompt,/Never emit http-request or execute-code/);
      assert.match(prompt,/source of truth/i);
    });

    test('the complete Apollo tool catalog still fits the Stellar developer message budget with a maximum idea',()=>{
      const prompt=buildStreamWeaverAiFlowPrompt('x'.repeat(4000));
      assert.ok(prompt.length<=8000,`prompt length was ${prompt.length}`);
    });
    ''',
)

write(
    "docs/STREAMWEAVER_STELLAR_FLOW_CODER.md",
    r'''
    # StreamWeaver Stellar Flow Coder

    ApolloStation is the execution source of truth. The deployed/live StreamWeaver can be used to discover useful behavior, but it does not define which actions the new runtime may execute.

    The Flow Builder sends a developer-surface request through the shared Community Assistant, whose hosted execution owner is Stellar Core. Before sending, StreamWeaver compiles its current registered capability catalogs into the prompt: suite actions, preserved native donor commands, authorized device-action vocabulary, paired devices, and configured chat connections. Generated packages are normalized and must pass the same runnable-package checks used by installed flows before they are saved as private drafts.

    ## Gap filling without arbitrary JavaScript

    Legacy `execute-code` and `http-request` steps remain unsupported. They are not silently enabled.

    Pure transformations can instead use **Flow Code** inside any normal string template. Flow Code is a small deterministic pipeline expression, for example `{{= argsText | trim | upper }}` or `{{= vars.points | number | add(args[0]) }}`. It can read only the current message arguments and flow variables and exposes a fixed list of string/math operations. It has no access to the network, filesystem, credentials, globals, prototypes, dynamic imports, `eval`, or arbitrary JavaScript.

    The AI is instructed to prefer registered native, cross-app, device, and assistant steps. Flow Code exists only to bridge pure value/logic gaps between those typed tools.

    ## Live-test loop

    1. Ask the AI Flow Builder for one human-described command feature.
    2. The result is saved only as a private, uninstalled draft after normalization and runnable validation.
    3. Inspect/preview it in a Simulation Room, then install it only when the generated graph and tool choices are correct.
    4. Use failed generation or simulation cases as regression fixtures before expanding the tool vocabulary.
    ''',
)

print("StreamWeaver Stellar flow-coder patch prepared")
