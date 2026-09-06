import type { ExecutionJobV1, NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1, SpmtSuiteActionIdV1 } from "@spmt/contracts";
import { SPMT_SUITE_ACTION_CATALOG } from "@spmt/contracts";
import type { StreamWeaverBotActionExecutorV1, StreamWeaverBotActorRoleV1 } from "./bot-action-runtime.js";
import type { StreamWeaverCommandStateV1 } from "./command-router.js";
import { assertStreamWeaverFlowRunnable, StreamWeaverFlowPackageStore, type StreamWeaverFlowActionV1, type StreamWeaverFlowPackageV1, type StreamWeaverFlowCommandV1 } from "./flow-packages.js";
import { renderFlowCodeExpression } from "./flow-code.js";

export interface StreamWeaverNativeFlowExecutorV1 { execute(donorId: string, delivery: NormalizedChatDeliveryV1): Promise<string | undefined>; }
export interface StreamWeaverFlowServicesV1 {
  speech?(input:{delivery:NormalizedChatDeliveryV1;text:string;voice?:string;requestId:string}):Promise<{jobId:string}>;
  points?(input:{delivery:NormalizedChatDeliveryV1;delta:number;ownerUserId:string;requestId:string}):Promise<number>;
  device?(input:{delivery:NormalizedChatDeliveryV1;deviceId:string;ownerUserId:string;action:string;payload:Record<string,unknown>;requestId:string}):Promise<{jobId:string}|{output:string}>;
  assistant?(input:{delivery:NormalizedChatDeliveryV1;prompt:string;requestId:string}):Promise<{status:"accepted";jobId:string}|{status:"unavailable";reason:string}>;
  getJob?(tenantId:string,jobId:string):Promise<ExecutionJobV1>;
}
type Outcome="success"|"true"|"false";
interface StepResult { text:string; output:string; outcome:Outcome; }
interface FlowExecution {
  delivery:NormalizedChatDeliveryV1; package:StreamWeaverFlowPackageV1; command:StreamWeaverFlowCommandV1;
  state:"running"|"waiting"|"failed"|"succeeded"; variables:Record<string,string>; queue:string[]; visited:string[];
  steps:Array<{actionId:string;type:string;state:string;output:string;outcome:Outcome}>;
  replies:string[]; cooldownKey:string; occurredAt:string; error?:string;
  pending?:{actionId:string;jobId?:string;wakeAt?:number};
  results:Record<string,StepResult>;
}
class PendingStep extends Error { constructor(readonly pending:NonNullable<FlowExecution["pending"]>){super("Flow is waiting for a step");} }

/** A saved run pins its package and delivery. Chat Gateway retries and the host reconciler resume that same run. */
export class StreamWeaverInstalledFlowConsumer {
  readonly id="streamweaver.installed-flows" as const;
  private readonly inFlight=new Map<string,Promise<void>>();
  constructor(private readonly packages:StreamWeaverFlowPackageStore,private readonly state:StreamWeaverCommandStateV1,private readonly egress:{send(message:OutboundChatMessageV1):Promise<{providerMessageId:string}>},private readonly suiteActions?:StreamWeaverBotActionExecutorV1,private readonly nativeActions?:StreamWeaverNativeFlowExecutorV1,private readonly nowMs:()=>number=Date.now,private readonly services:StreamWeaverFlowServicesV1={}){}
  accepts(message:NormalizedChatMessageV1){return !message.actor.isBot&&Boolean(this.match(message));}
  deliver(delivery:NormalizedChatDeliveryV1):Promise<void>{
    const key=JSON.stringify([delivery.message.tenantId,delivery.deliveryId]);
    const existing=this.inFlight.get(key);if(existing)return existing;
    const task=this.execute(delivery).finally(()=>this.inFlight.delete(key));this.inFlight.set(key,task);return task;
  }
  async reconcile(limit=100){
    const runs=this.packages.waitingExecutions<FlowExecution>(limit);let resumed=0;
    for(const run of runs){if(run.pending?.wakeAt&&run.pending.wakeAt>this.nowMs())continue;try{await this.deliver(run.delivery);resumed++;}catch{/* Failure is recorded with its original command and may be retried from Activity. */}}
    return {resumed};
  }
  /** The simulation worker owns a renewable job lease while scheduled steps finish. */
  async settle(){
    for(;;){const pending=this.packages.waitingExecutions<FlowExecution>();if(!pending.length)return;
      const wakeAt=Math.min(...pending.map(run=>run.pending?.wakeAt??this.nowMs()+500));
      if(wakeAt>this.nowMs())await new Promise(resolve=>setTimeout(resolve,Math.min(1000,wakeAt-this.nowMs())));
      await this.reconcile();
    }
  }
  private async execute(delivery:NormalizedChatDeliveryV1){
    const tenantId=delivery.message.tenantId,receiptId=`flow:${delivery.deliveryId}`;
    if(this.state.getReceipt(tenantId,receiptId))return;
    let run=this.packages.execution<FlowExecution>(tenantId,delivery.deliveryId);
    if(run?.state==="succeeded")return;
    if(!run){
      const match=this.match(delivery.message);if(!match)return;
      assertStreamWeaverFlowRunnable(match.package);
      if(roleLevel(actorRole(delivery.message))<roleLevel(match.command.minimumRole??'guest')){await this.send(delivery,`This command requires ${match.command.minimumRole} access.`);return;}
      const cooldownKey=JSON.stringify(["flow",tenantId,delivery.message.provider,delivery.message.channelId,match.package.packageId,match.command.id,delivery.message.actor.canonicalUserId??delivery.message.actor.providerUserId]);
      const globalKey=JSON.stringify(["flow-global",tenantId,delivery.message.provider,delivery.message.channelId,match.package.packageId,match.command.id]),last=this.state.getCooldown(cooldownKey),globalLast=this.state.getCooldown(globalKey),remaining=Math.max(last?Math.ceil((last+match.command.cooldownSeconds*1000-this.nowMs())/1000):0,globalLast?Math.ceil((globalLast+(match.command.globalCooldownSeconds??0)*1000-this.nowMs())/1000):0);
      if(remaining>0){this.packages.recordRun(tenantId,delivery.deliveryId,{packageId:match.package.packageId,command:match.command.trigger,input:delivery.message.text,provider:delivery.message.provider,actor:delivery.message.actor.displayName??delivery.message.actor.username,occurredAt:new Date(this.nowMs()).toISOString(),steps:[],state:"cooldown"});await this.send(delivery,`Wait ${remaining}s before using ${match.command.trigger} again.`);return;}
      run={delivery:structuredClone(delivery),package:structuredClone(match.package),command:structuredClone(match.command),state:"running",variables:this.packages.variables(tenantId,match.package.packageId),queue:roots(match.command),visited:[],steps:[],replies:[],results:{},cooldownKey,occurredAt:new Date(this.nowMs()).toISOString()};
      this.save(run);this.state.putCooldown(cooldownKey,this.nowMs());this.state.putCooldown(globalKey,this.nowMs());
    }
    delivery=run.delivery;run.state="running";delete run.error;
    try{
      while(run.queue.length){
        const id=run.queue[0]!,action=run.package.actions.find(a=>a.id===id)!;
        if(run.visited.includes(id)){run.queue.shift();continue;}
        let result=Object.hasOwn(run.results,id)?run.results[id]:undefined;
        if(!result){
          result=action.enabled?await this.step(action,delivery,run,false):{text:"",output:"",outcome:action.type==="condition"?"false":"success"};
          run.results[id]=result;this.save(run);
        }
        if(result.text){await this.send(delivery,result.text,id);run.replies.push(result.text);}
        if(result.output){run.variables.lastOutput=result.output;if(action.config.saveAs)run.variables[String(action.config.saveAs)]=result.output;}
        run.steps.push({actionId:id,type:action.type,state:action.enabled?"succeeded":"skipped",output:result.output,outcome:result.outcome});
        run.visited.push(id);run.queue.shift();delete run.pending;
        for(const next of successors(run.command,id,result.outcome))if(!run.visited.includes(next)&&!run.queue.includes(next))run.queue.push(next);
        this.save(run);
      }
      run.state="succeeded";this.save(run);
      this.state.putReceipt({tenantId,deliveryId:receiptId,command:run.command.trigger,text:run.replies.join("\n").slice(0,8000),createdAt:new Date(this.nowMs()).toISOString()});
    }catch(error){
      if(error instanceof PendingStep){run.state="waiting";run.pending=error.pending;this.save(run);return;}
      run.state="failed";run.error=error instanceof Error?error.message:"Flow execution failed";this.save(run);throw error;
    }
  }
  private save(run:FlowExecution){
    const {delivery,package:item,command}=run;
    this.packages.saveExecution(delivery.message.tenantId,delivery.deliveryId,run.state,run);
    this.packages.recordRun(delivery.message.tenantId,delivery.deliveryId,{packageId:item.packageId,command:command.trigger,input:delivery.message.text,provider:delivery.message.provider,channelId:delivery.message.channelId,actor:delivery.message.actor.displayName??delivery.message.actor.username,occurredAt:run.occurredAt,state:run.state,steps:run.steps,...(run.pending?{pending:run.pending}:{}),...(run.error?{error:run.error}:{})});
  }
  async preview(item:StreamWeaverFlowPackageV1,commandId:string,delivery:NormalizedChatDeliveryV1){
    const command=item.commands.find(c=>c.id===commandId);if(!command)throw new Error("Flow preview command does not exist");
    const run:FlowExecution={delivery,package:item,command,state:"running",variables:{},queue:roots(command),visited:[],steps:[],replies:[],results:{},cooldownKey:"",occurredAt:new Date(this.nowMs()).toISOString()};
    const outputs:Array<{actionId:string;type:StreamWeaverFlowActionV1["type"];text:string}>=[];
    while(run.queue.length){const id=run.queue.shift()!;if(run.visited.includes(id))continue;const action=item.actions.find(a=>a.id===id)!,result:StepResult=action.enabled?await this.step(action,delivery,run,true):{text:"",output:"",outcome:action.type==="condition"?"false":"success"};run.visited.push(id);if(result.output){run.variables.lastOutput=result.output;if(action.config.saveAs)run.variables[String(action.config.saveAs)]=result.output;}if(result.text)outputs.push({actionId:id,type:action.type,text:result.text});for(const next of successors(command,id,result.outcome))if(!run.visited.includes(next))run.queue.push(next);}
    return {command,outputs};
  }
  private match(message:NormalizedChatMessageV1){
    const rawFirst=message.text.trim().split(/\s+/)[0]??"";
    for(const item of this.packages.listInstalledPackages(message.tenantId))for(const command of item.commands){
      if(!command.enabled||command.runtime!=="flow")continue;
      const norm=(value:string)=>command.caseSensitive?value:value.toLowerCase(),first=norm(rawFirst);
      if(command.matcher==="command"&&(norm(command.trigger)===first||command.aliases.some(a=>norm(a)===first)))return {package:item,command};
      if(command.matcher==="bare"&&(norm(message.text.trim())===norm(command.trigger)||first===`!${norm(command.trigger)}`))return {package:item,command};
      if(command.matcher==="regex"&&regexMatch(command.trigger,message.text,command.caseSensitive))return {package:item,command};
    }
    return undefined;
  }
  private async step(action:StreamWeaverFlowActionV1,delivery:NormalizedChatDeliveryV1,run:FlowExecution,preview:boolean):Promise<StepResult>{
    const render=(value:unknown)=>renderFlowTemplate(String(value??""),delivery.message,run.variables);
    const result=(output="",text="",outcome:Outcome="success"):StepResult=>({output,text,outcome});
    if(action.type==="send-chat"){const text=render(action.config.text);return result(text,text);}
    if(action.type==="set-variable"){
      const key=String(action.config.key??action.config.name??"");if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))throw new Error("Choose a variable name using letters, numbers, and underscores");
      const value=render(action.config.value);run.variables[key]=value;
      if(action.config.scope==="persistent"&&!preview)this.packages.setVariable(delivery.message.tenantId,run.package.packageId,key,value);
      return result(value);
    }
    if(action.type==="condition"){
      const left=render(action.config.left??"{{lastOutput}}"),right=render(action.config.right),op=String(action.config.operator);
      let passed=false;
      if(op==="=="||op==="===")passed=left===right;else if(op==="!="||op==="!==")passed=left!==right;else if(op==="includes")passed=left.includes(right);else if(op==="exists")passed=Boolean(left);
      else {const a=Number(left),b=Number(right);if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error("Numeric conditions need finite numbers");if(op===">")passed=a>b;else if(op===">=")passed=a>=b;else if(op==="<")passed=a<b;else if(op==="<=")passed=a<=b;else throw new Error("Unsupported condition operator");}
      return result("","",passed?"true":"false");
    }
    if(action.type==="wait"){
      const ms=Number(action.config.milliseconds??action.config.value??0);if(!Number.isFinite(ms)||ms<0||ms>60000)throw new Error("Wait steps must be between 0 and 60000 milliseconds");
      if(preview)return result("",ms?`Wait ${ms}ms`:"");
      const wakeAt=run.pending?.actionId===action.id?run.pending.wakeAt:this.nowMs()+ms;
      if(wakeAt&&wakeAt>this.nowMs())throw new PendingStep({actionId:action.id,wakeAt});return result();
    }
    if(action.type==="send-discord"){
      const text=render(action.config.text??action.config.message),connectionId=render(action.config.connectionId)||(delivery.message.provider==="discord"?delivery.message.connectionId:""),channelId=render(action.config.channelId)||(delivery.message.provider==="discord"?delivery.message.channelId:"");
      if(!text.trim())throw new Error("Discord message text is required");if(!connectionId||!channelId)throw new Error("Choose a connected Discord destination for this step");
      if(preview)return result(text,text);
      await this.egress.send({schemaVersion:1,tenantId:delivery.message.tenantId,provider:"discord",connectionId,channelId,text,idempotencyKey:`streamweaver-flow-discord:${delivery.deliveryId}:${action.id}`});return result(text);
    }
    if(action.type==="obs-scene"||action.type==="obs-source"||action.type==="device-command"){
      if(preview)return result("","Run this flow in a Simulation Room to inspect the isolated device state.");
      if(!this.services.device)throw new Error("Companion device execution is unavailable");
      const pending=run.pending?.actionId===action.id?run.pending.jobId:undefined;
      if(pending)return result(await this.jobResult(delivery,action.id,pending));
      const payload=action.type==="obs-scene"?{sceneName:render(action.config.sceneName??action.config.scene)}:action.type==="obs-source"?{sceneName:render(action.config.sceneName??action.config.scene),sourceName:render(action.config.sourceName??action.config.source),visible:action.config.visible}:Object.fromEntries(Object.entries(record(action.config.payload)??{}).map(([key,value])=>[key,typeof value==="string"?render(value):value]));
      const response=await this.services.device({delivery,deviceId:String(action.config.deviceId??""),ownerUserId:run.package.author.id,action:action.type==="obs-scene"?"obs.scene.set":action.type==="obs-source"?"obs.source.visibility.set":String(action.config.action??""),payload,requestId:`flow-device:${delivery.deliveryId}:${action.id}`});
      return result('output' in response?response.output:await this.jobResult(delivery,action.id,response.jobId));
    }
    if(action.type==="speak") {
      const text=render(action.config.text);
      if(preview)return result("",`Would speak: ${text}`);
      if(!this.services.speech)throw new Error("Speech is unavailable for this flow");
      let jobId=run.pending?.actionId===action.id?run.pending.jobId:undefined;
      if(!jobId)jobId=(await this.services.speech({delivery,text,...(action.config.voice?{voice:String(action.config.voice)}:{}),requestId:`flow-speech:${delivery.deliveryId}:${action.id}`})).jobId;
      return result(await this.jobResult(delivery,action.id,jobId));
    }
    if(action.type==="points") {
      const delta=Number(render(action.config.delta));if(!Number.isSafeInteger(delta)||Math.abs(delta)>1e12)throw new Error("Point change must be a whole number");
      if(preview)return result("",`Would change the viewer's streamer points by ${delta}`);
      if(!this.services.points)throw new Error("Streamer currency is unavailable for this flow");
      const balance=await this.services.points({delivery,delta,ownerUserId:run.package.author.id,requestId:`flow-points:${delivery.deliveryId}:${action.id}`});return result(String(balance));
    }
    if(action.type==="ai-response"){
      if(preview)return result("","AI response requires running this command in a Simulation Room with an available assistant worker.");
      if(!this.services.assistant)throw new Error("The shared assistant is unavailable for this flow");
      let jobId=run.pending?.actionId===action.id?run.pending.jobId:undefined;
      if(!jobId){const response=await this.services.assistant({delivery,prompt:render(action.config.input),requestId:`flow:${delivery.deliveryId}:${action.id}`});if(response.status!=="accepted")throw new Error(response.reason);jobId=response.jobId;}
      return result(await this.jobResult(delivery,action.id,jobId));
    }
    if(action.type==="run-action"){
      const id=String(action.config.action??"") as SpmtSuiteActionIdV1,descriptor=SPMT_SUITE_ACTION_CATALOG.find(a=>a.id===id);
      if(!descriptor)throw new Error("Choose a registered SPMT suite action");
      if(preview)return result("",`Would run ${descriptor.id} (${descriptor.risk})`);
      if(!this.suiteActions)throw new Error("The registered suite action executor is unavailable");
      if(!delivery.message.actor.canonicalUserId)throw new Error("Link your chat account to SPMT before running cross-app actions");
      const role=actorRole(delivery.message);if(roleLevel(role)<roleLevel(descriptor.minimumRole))throw new Error(`That ${descriptor.risk} action requires ${descriptor.minimumRole} access.`);
      const pending=run.pending?.actionId===action.id?run.pending.jobId:undefined;
      if(pending){const output=await this.jobResult(delivery,action.id,pending);return result(output,action.config.sendResult===false||action.config.sendResult==="false"?"":output);}
      const response=await this.suiteActions.execute({action:id,args:Object.fromEntries(Object.entries(record(action.config.args)??{}).map(([k,v])=>[k,render(v)])),detection:"explicit"},{tenantId:delivery.message.tenantId,source:delivery.message.provider,connectionId:delivery.message.connectionId,channelId:delivery.message.channelId,requestId:`${delivery.deliveryId}:${action.id}`,actor:{...(delivery.message.actor.canonicalUserId?{userId:delivery.message.actor.canonicalUserId}:{}),username:delivery.message.actor.username,role}});
      const state=String(response.result?.state??"");if(["failed","dead-letter","cancelled"].includes(state))throw new Error(response.response);
      if(response.result?.unavailable===true)throw new Error(response.response);
      if(response.result?.jobId&&state&&state!=="succeeded")throw new PendingStep({actionId:action.id,jobId:String(response.result.jobId)});
      return result(response.response,action.config.sendResult===false||action.config.sendResult==="false"?"":response.response);
    }
    if(action.type==="run-native"){
      const donorId=String(action.config.donorId??"");if(!this.nativeActions||!donorId)throw new Error("The native StreamWeaver capability is unavailable");
      const output=await this.nativeActions.execute(donorId,delivery)??"";return result(output,output);
    }
    throw new Error(`Flow step ${action.type} needs a registered execution capability. Replace it with an available action before enabling this flow.`);
  }
  private async jobResult(delivery:NormalizedChatDeliveryV1,actionId:string,jobId:string){
    if(!this.services.getJob)throw new Error("The shared job result service is unavailable");
    const job=await this.services.getJob(delivery.message.tenantId,jobId);
    if(job.state==="succeeded"){const body=record(job.result);return String(body?.text??record(body?.output)?.text??JSON.stringify(body??{})).slice(0,16000);}
    if(["failed","dead-letter","cancelled"].includes(job.state))throw new Error(String(record(job.error)?.message??`Job ${job.state}`));
    throw new PendingStep({actionId,jobId});
  }
  private send(delivery:NormalizedChatDeliveryV1,text:string,stepId="status"){return this.egress.send({schemaVersion:1,tenantId:delivery.message.tenantId,provider:delivery.message.provider,connectionId:delivery.message.connectionId,channelId:delivery.message.channelId,text,idempotencyKey:`streamweaver-flow:${delivery.deliveryId}:${stepId}`,replyToMessageId:delivery.message.messageId});}
}
function roots(command:StreamWeaverFlowCommandV1){return command.actionIds.slice(0,1);}
function successors(command:StreamWeaverFlowCommandV1,id:string,outcome:Outcome){if(command.edges!==undefined)return command.edges.filter(e=>e.source===id&&(!e.outcome||e.outcome===outcome)).map(e=>e.target);const next=command.actionIds[command.actionIds.indexOf(id)+1];return next?[next]:[];}
export function renderFlowTemplate(value:string,message:NormalizedChatMessageV1,variables:Record<string,string>){
  const args=message.text.trim().split(/\s+/).slice(1),tags:Record<string,string>={"display-name":message.actor.displayName??message.actor.username,username:message.actor.username,"user-id":message.actor.canonicalUserId??message.actor.providerUserId};
  const rendered=value.replace(/\{\{\s*([^}]+?)\s*\}\}/g,(_,rawToken:string)=>{
    const token=rawToken.trim();
    if(token.startsWith("="))return renderFlowCodeExpression(token.slice(1),{message:message.text,args,userName:tags["display-name"]!,user:message.actor.username,targetUser:message.mentions[0]?.username??"",lastOutput:variables.lastOutput??"",vars:variables});
    const path=token.replace(/\[['"]?([^\]'" ]+)['"]?\]/g,".$1").split(".");
    if(path[0]==="args")return path.length===1?args.join(" "):args[Number(path[1])]??"";
    if(path[0]==="tags")return tags[path[1]!]??"";
    if(path[0]==="vars")return Object.hasOwn(variables,path[1]!)?variables[path[1]!]??"":"";
    return Object.hasOwn(variables,token)?variables[token]??"":"";
  });
  return rendered.replaceAll("%userName%",tags["display-name"]!).replaceAll("%user%",message.actor.username).replaceAll("%message%",message.text).replaceAll("%rawInput%",message.text).replaceAll("%args%",args.join(" ")).replaceAll("%targetUser%",message.mentions[0]?.username??"").slice(0,16000);
}
function actorRole(message:NormalizedChatMessageV1):StreamWeaverBotActorRoleV1{return message.actor.roles.includes("broadcaster")?"owner":message.actor.roles.includes("moderator")?"moderator":message.actor.roles.includes("member")?"member":"guest";}
function roleLevel(role:StreamWeaverBotActorRoleV1){return {guest:0,member:1,moderator:2,admin:3,owner:4}[role];}
function record(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function regexMatch(pattern:string,value:string,caseSensitive=false){try{const legacyInsensitive=pattern.startsWith("(?i)");return new RegExp(legacyInsensitive?pattern.slice(4):pattern,caseSensitive?"":"i").test(value);}catch{return false;}}
