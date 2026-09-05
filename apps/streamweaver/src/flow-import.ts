import { createHash } from "node:crypto";
import { SPMT_SUITE_ACTION_CATALOG } from "@spmt/contracts";
import { normalizeFlowPackage, type StreamWeaverFlowActionV1, type StreamWeaverFlowCommandV1, type StreamWeaverFlowPackageV1 } from "./flow-packages.js";

type Json=Record<string,unknown>;
export interface StreamWeaverImportReviewV1 { packages:StreamWeaverFlowPackageV1[]; warnings:Array<{packageId:string;stepId?:string;message:string}>; }
/** Lossless source retention with explicit typed replacements; unknown steps never become executable JavaScript. */
export function importStreamWeaverLegacy(value:unknown,author:{id:string;displayName?:string},now=new Date().toISOString(),scopeId=author.id):StreamWeaverImportReviewV1 {
  const source=object(value),digest=createHash("sha256").update(scopeId+"\0"+JSON.stringify(source)).digest("hex").slice(0,16),warnings:StreamWeaverImportReviewV1["warnings"]=[],packages:StreamWeaverFlowPackageV1[]=[];
  const rawCommands=list(source.commands??source.Commands),rawActions=list(source.actions??source.Actions);
  if(!rawCommands.length&&!rawActions.length&&!Array.isArray(source.nodes))throw new Error("Import a StreamWeaver graph/package or a Streamer.bot commands/actions JSON archive");
  if(rawCommands.length>32||rawActions.length>128)throw new Error("Import at most 32 commands and 128 actions at once");
  const actionsById=new Map(rawActions.map(a=>[String(a.id),a])),used=new Set<string>();
  const entries:Json[]=rawActions.length?[...rawCommands,...rawActions.map(a=>({id:a.id,name:a.name,actionId:a.id}))]:rawCommands.length?rawCommands: [{id:'graph',name:source.name??'Imported graph',actionId:'graph'}];
  if(Array.isArray(source.nodes))actionsById.set('graph',{id:'graph',flow:source});
  for(const [index,command] of entries.entries()){
    const packageId=`import.${digest}.${index}`,steps:StreamWeaverFlowActionV1[]=[],edges:NonNullable<StreamWeaverFlowCommandV1['edges']>=[],references=new Set<string>();let graph=false;
    const warn=(stepId:string,message:string)=>warnings.push({packageId,stepId,message});
    function add(raw:Json,type:StreamWeaverFlowActionV1['type'],config:Json){const id=`step.${steps.length}`;steps.push({id,type,enabled:raw.enabled!==false,config:{...config,legacy:structuredClone(raw)}});return id;}
    function unmapped(raw:Json,reason:string){const id=add(raw,'execute-code',{migrationRequired:reason});warn(id,reason);return [id];}
    function mapStep(raw:Json):string[]{
      const c={...raw,...object(raw.config??raw.data)},type=String(raw.subtype??raw.$type??raw.type??'').replace(/^.*\./,'').replace(/,.*$/,'').replace(/\s+/g,'').toLowerCase();
      if(['runaction','executeaction'].includes(type))return expand(String(c.actionId??''),String(c.actionName??''));
      if(['send-chat','sendchatmessage','twitchchatmessage','action:send-chat'].includes(type))return [add(raw,'send-chat',{text:c.text??c.message??''})];
      if(['send-discord','discordsendmessage','discordmessage','discord','senddiscordmessage'].includes(type))return [add(raw,'send-discord',{text:c.text??c.message??'',channelId:c.channelId??'',connectionId:c.connectionId??''})];
      if(['delay','wait'].includes(type)){const ms=c.milliseconds??(raw.subtype==='delay'?Number(c.seconds??c.duration??0)*1000:c.duration??c.value??0);return [add(raw,'wait',{milliseconds:Number(ms)})];}
      if(type==='start')return [add(raw,'wait',{milliseconds:0})];
      if(['set-variable','setargument','setvariable','setglobalvariable'].includes(type))return [add(raw,'set-variable',{key:c.key??c.variableName??c.name??'value',value:c.value??c.default??'',scope:type==='setglobalvariable'?'persistent':'run'})];
      if(type==='ai-response')return [add(raw,'ai-response',{input:c.input??'',saveAs:c.saveAs??'aiResponse'})];
      if(type==='text-includes')return [add(raw,'condition',{left:c.source??'{{lastOutput}}',right:c.value??'',operator:'includes'})];
      if(type==='compare')return [add(raw,'condition',{left:c.left??'',right:c.right??'',operator:c.operator??'=='})];
      if(type==='plugin-command'&&SPMT_SUITE_ACTION_CATALOG.some(a=>a.id===c.command))return [add(raw,'run-action',{action:c.command,args:c.payload??{}})];
      const routes:Record<string,StreamWeaverFlowActionV1['type']>={obssetscene:'obs-scene',obssetsourcevisibility:'obs-source','http-request':'http-request',http:'http-request'};
      if(routes[type]){const id=add(raw,routes[type]!,c);warn(id,`${String(raw.type??raw.subtype)} needs its paired ecosystem capability selected.`);return [id];}
      return unmapped(raw,`Map ${String(raw.type??raw.subtype??raw.$type??'unknown action')} to an authorized ecosystem capability before enabling it.`);
    }
    function connect(previous:string[],next:string[],outcome?:'success'|'true'|'false'){
      if(!previous.length||!next.length)return;
      for(const source of previous){
        const outgoing=edges.filter(edge=>edge.source===source&&previous.includes(edge.target)),condition=steps.find(step=>step.id===source)?.type==='condition';
        if(condition){for(const branch of ['true','false'] as const)if((outcome===undefined||outcome==='success'||outcome===branch)&&!outgoing.some(edge=>edge.outcome===undefined||edge.outcome===branch))edges.push({source,target:next[0]!,outcome:branch});}
        else if(!outgoing.length)edges.push({source,target:next[0]!,...(outcome===undefined?{}:{outcome})});
      }
    }
    function expand(id:string,name=''):string[]{
      const target=actionsById.get(id)??rawActions.find(a=>name&&a.name===name);
      if(!target)return unmapped({actionId:id,actionName:name},'The referenced action is absent from this archive. Import the matching actions JSON.');
      const key=String(target.id);if(references.has(key))throw new Error('Imported actions recursively invoke each other');references.add(key);used.add(key);
      const flow=object(target.flow??target.graph??target.flowGraph);let ids:string[]=[];
      if(Array.isArray(flow.nodes)){
        graph=true;const mapping=new Map<string,string[]>(),nodes=list(flow.nodes),nodeIds=new Set(nodes.map(n=>String(n.id)));
        if(nodes.filter(n=>n.type==='trigger').length>1)throw new Error('Split multiple graph triggers into individual command packages before importing');
        const ordered=[...nodes.filter(n=>n.type==='trigger'),...nodes.filter(n=>n.type!=='trigger')];
        for(const node of ordered){const mapped=mapStep(node);mapping.set(String(node.id),mapped);ids.push(...mapped);}
        for(const edge of list(flow.edges)){
          if(!nodeIds.has(String(edge.source))||!nodeIds.has(String(edge.target)))throw new Error('Imported graph has an edge to a missing node');
          const from=mapping.get(String(edge.source))!,to=mapping.get(String(edge.target))!,outcomes=object(edge.conditions).outcome??edge.sourceHandle;
          for(const outcome of Array.isArray(outcomes)?outcomes:[outcomes]){if(outcome!==undefined&&!['success','true','false'].includes(String(outcome)))throw new Error(`Unsupported graph outcome: ${outcome}`);connect(from,to,outcome===undefined?undefined:String(outcome) as 'success'|'true'|'false');}
        }
      }else {const subs=list(target.subActions??target.subactions);if(!subs.length)ids=unmapped(target,'This action has no executable subactions. Select its ecosystem replacement.');else for(const sub of subs){const next=mapStep(sub);connect(ids,next);ids.push(...next);}}
      references.delete(key);return ids;
    }
    let actionIds:string[]=[];
    const ids=Array.isArray(command.actionIds)?command.actionIds.map(String):command.actionId?[String(command.actionId)]:[];
    if(!ids.length&&rawActions.length===1)ids.push(String(rawActions[0]!.id));
    if(!ids.length){const matches=rawActions.filter(a=>list(a.triggers).some(t=>object(t.config).commandId===command.id||t.commandId===command.id));ids.push(...matches.map(a=>String(a.id)));}
    for(const id of ids){const next=expand(id);connect(actionIds,next);actionIds.push(...next);}
    if(!actionIds.length)actionIds=unmapped(command,'Choose the action that should run for this imported command.');
    const triggers=String(command.command??command.trigger??('!'+String(command.name??'imported').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90))).split(/[\r\n]+/).filter(Boolean),trigger=triggers[0]??'!imported';
    const commands=[{id:`command.${index}`,trigger,aliases:[...triggers.slice(1),...listStrings(command.aliases)],actionIds,enabled:false,caseSensitive:command.caseSensitive===true,globalCooldownSeconds:Number(command.globalCooldown??object(command.cooldown).global??0),...(command.permittedUsers||command.permittedGroups||command.permissions||command.sources?{migrationNote:'Review imported access rules and choose an Apollo access level before enabling.'}:{}),runtime:'flow',matcher:command.mode===1||command.regex?'regex':trigger.startsWith('!')?'command':'bare',cooldownSeconds:Number(command.userCooldown??object(command.cooldown).user??0),...(graph?{edges}:{})}];
    if(command.permittedUsers||command.permittedGroups||command.permissions||command.sources||command.globalCooldown)warnings.push({packageId,message:'Review legacy permissions, source filters and global cooldown before enabling this import; the original values are retained.'});
    const candidate=normalizeFlowPackage({schemaVersion:1,kind:'streamweaver.flow-package',packageId,packageKind:commands.length?'command_flow':'action_flow',name:String(command.name??source.name??trigger).slice(0,120),description:String(command.description??source.description??'Imported flow').slice(0,1000),author,commands,actions:steps,legacySource:{format:'legacy-streamweaver-or-streamerbot',source:structuredClone(source),commandIndex:index}}, {now,author,visibility:'private'});
    packages.push(candidate);
  }
  for(const raw of rawActions)if(!used.has(String(raw.id)))warnings.push({packageId:packages[0]!.packageId,message:`Unreferenced action ${String(raw.name??raw.id)} is retained in the original archive. Import it as an action package to edit it independently.`});
  return {packages,warnings};
}
function object(value:unknown):Json{return value&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};}
function list(value:unknown):Json[]{return Array.isArray(value)?value.map(object):[];}
function listStrings(value:unknown):string[]{return Array.isArray(value)?value.map(String):[];}
