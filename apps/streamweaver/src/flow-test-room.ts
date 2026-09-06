import {createHash,randomUUID} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {SpmtClient} from "@spmt/sdk";
import type {NormalizedChatDeliveryV1} from "@spmt/contracts";
import {StreamWeaverProviderRuntime} from "./provider-runtime.js";
import {StreamWeaverFlowPackageStore,assertStreamWeaverFlowRunnable,type StreamWeaverFlowPackageV1} from "./flow-packages.js";
import {StreamWeaverSecureChoiceStore,type StreamWeaverSecureChoiceSessionV1} from "./secure-choice.js";

/** Owner-operated synthetic players. Files and transports are separate from every live game. */
export class StreamWeaverFlowTestRoom {
  constructor(private readonly directory:string,private readonly client:SpmtClient){}
  private path(tenant:string,user:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error("Invalid flow test ID");return join(this.directory,createHash("sha256").update(`${tenant}\0${user}`).digest("hex"),id);}
  private async emit(tenant:string,roomId:string,text:string,key:string){await this.client.publishSimulationRoomEvent(tenant,{roomId,roomName:"Flow Builder tests",lane:"chat",direction:"egress",title:"StreamWeaver test",body:text.replace(/https:\/\/simulation\.invalid\/\S+/g,"[use the test-player controls in Flow Builder]"),provider:"twitch",connectionId:"simulation",channelId:roomId},key);}
  async start(tenant:string,user:string,pkg:StreamWeaverFlowPackageV1){
    assertStreamWeaverFlowRunnable(pkg);
    const id=randomUUID(),base=this.path(tenant,user,id),roomId=`streamweaver:flow-test:${user}`,db=join(base,"flow.sqlite"),time=Date.now();mkdirSync(base,{recursive:true});
    const meta={roomId,time,sessionId:"",packageId:pkg.packageId};
    const store=new StreamWeaverFlowPackageStore(db),command=pkg.commands.find(c=>c.role==="primary")!;
    store.saveDraft(tenant,pkg,pkg.author);store.install(tenant,pkg.packageId);store.close();
    const localClient=new SpmtClient({baseUrl:"https://simulation.invalid",appId:"streamweaver",fetchImpl:async()=>{throw Error("This flow test cannot access live services; add an isolated adapter for this action");}});
    const runtime=new StreamWeaverProviderRuntime({databasePath:db,client:localClient,egress:{send:async message=>{await this.emit(tenant,roomId,message.text,`flow-test:${id}:${message.idempotencyKey}`);return{providerMessageId:randomUUID()};}},allowAssistant:false,simulation:true,publicOrigin:"https://simulation.invalid",now:()=>new Date(time).toISOString(),nowMs:()=>time});
    const delivery:NormalizedChatDeliveryV1={schemaVersion:1,deliveryId:id,consumerId:"streamweaver.installed-flows",attempts:1,message:{schemaVersion:1,tenantId:tenant,provider:"twitch",connectionId:"simulation",channelId:roomId,messageId:id,text:`${command.trigger} @TestPlayerB`,occurredAt:new Date(time).toISOString(),actor:{providerUserId:"test-a",canonicalUserId:"test-a",username:"TestPlayerA",displayName:"Test player A",isBot:false,roles:["broadcaster"]},mentions:[{token:"@TestPlayerB",providerUserId:"test-b",canonicalUserId:"test-b",username:"TestPlayerB"}]}};
    try{const consumer=runtime.consumers.find(c=>c.id==="streamweaver.installed-flows");if(!consumer||!consumer.accepts(delivery.message))throw Error("The generated primary command did not match the test input");await this.client.publishSimulationRoomEvent(tenant,{roomId,roomName:"Flow Builder tests",lane:"chat",direction:"ingress",title:"Test player A",body:delivery.message.text,provider:"twitch"},`flow-test:${id}:input`);await consumer.deliver(delivery);}finally{runtime.close();}
    const evidence=new StreamWeaverFlowPackageStore(db);try{const run=evidence.listRuns(tenant).find(r=>r.deliveryId===id);if(run?.state!=="succeeded")throw Error(`Shadow command did not complete successfully (${run?.state??"no execution"}); an isolated adapter or additional test input is required`);}finally{evidence.close();}
    const choices=new StreamWeaverSecureChoiceStore(db,()=>new Date(time).toISOString());try{for(const action of pkg.actions){const session=choices.byRequest(tenant,`${id}:${action.id}`);if(session){meta.sessionId=session.sessionId;break;}}}finally{choices.close();}
    writeFileSync(join(base,"meta.json"),JSON.stringify(meta),{mode:0o600});
    return this.view(tenant,user,id,"a");
  }
  async act(tenant:string,user:string,id:string,seat:"a"|"b",action:string,index?:number){
    const base=this.path(tenant,user,id),meta=JSON.parse(readFileSync(join(base,"meta.json"),"utf8"));
    if(action==="expire"){meta.time+=901000;writeFileSync(join(base,"meta.json"),JSON.stringify(meta));}
    const store=new StreamWeaverSecureChoiceStore(join(base,"flow.sqlite"),()=>new Date(meta.time).toISOString());
    try{const session=store.find(meta.sessionId);if(!session||session.tenantId!==tenant)throw Error("This flow did not create a secure choice game");const player=seat==="a"?session.challenger:session.challenged;
      if(action==="accept")store.accept(session.sessionId,player.token,player.userId,"https://simulation.invalid");
      else if(action==="decline")store.decline(session.sessionId,player.token,player.userId);
      else if(action==="choose")store.choose(session.sessionId,player.token,player.userId,Number(index),"https://simulation.invalid");
      else if(action!=="view"&&action!=="expire")throw Error("Unknown test action");
      await store.flushOutbox(message=>this.emit(tenant,meta.roomId,message.text,`flow-test:${id}:${message.idempotencyKey}`));
    }finally{store.close();}
    return this.view(tenant,user,id,seat);
  }
  view(tenant:string,user:string,id:string,seat:"a"|"b"){
    const base=this.path(tenant,user,id),meta=JSON.parse(readFileSync(join(base,"meta.json"),"utf8")),store=new StreamWeaverSecureChoiceStore(join(base,"flow.sqlite"));
    try{const session=store.find(meta.sessionId);if(session&&session.tenantId!==tenant)throw Error("Test unavailable");const player=session?(seat==="a"?session.challenger:session.challenged):undefined;return{id,roomId:meta.roomId,seat,state:session?.state??"completed",title:session?.title??"Flow test",round:session?.round,locked:Boolean(player?.choiceId),options:session?.state==="active"&&!player?.choiceId?player?.order.map((optionId,index)=>({index:index+1,label:session.config.options.find(o=>o.id===optionId)?.label})):[],result:session?.state==="resolved"?session.result:undefined,canAccept:session?.state==="pending"&&seat==="b"};}finally{store.close();}
  }
  async test(tenant:string,user:string,pkg:StreamWeaverFlowPackageV1){
    const action=pkg.actions.find(a=>a.enabled&&a.type==="run-native"&&a.config.donorId==="secure-choice-session");
    if(!action){const run=await this.start(tenant,user,pkg);return{passed:true,scope:"Primary command executed with capture-only transports; no external action adapters are enabled.",roomId:run.roomId};}
    const checks:Array<{name:string;passed:boolean}>=[];let roomId="";
    const config=action.config as unknown as StreamWeaverSecureChoiceSessionV1["config"];
    // Independent oracle for the standard five-choice game, not the model's declared winners.
    const standard=["scissors:paper","paper:rock","rock:lizard","lizard:spock","spock:scissors","scissors:lizard","lizard:paper","paper:spock","spock:rock","rock:scissors"];
    if(["rock","paper","scissors","lizard","spock"].every(id=>config.options.some(o=>o.id===id)))checks.push({name:"Ten standard RPSLS winning pairs",passed:standard.every(pair=>config.relations.some(r=>`${r.winner}:${r.loser}`===pair))});
    for(const relation of config.relations){const run=await this.start(tenant,user,pkg);roomId=run.roomId;const b=await this.act(tenant,user,run.id,"b","accept"),a=this.view(tenant,user,run.id,"a");const first=a.options!.find(o=>o.label===config.options.find(o=>o.id===relation.winner)?.label)!,second=b.options!.find(o=>o.label===config.options.find(o=>o.id===relation.loser)?.label)!;await this.act(tenant,user,run.id,"a","choose",first.index);const hidden=this.view(tenant,user,run.id,"b");const result=await this.act(tenant,user,run.id,"b","choose",second.index);checks.push({name:`${relation.winner} beats ${relation.loser}; hidden until both commit`,passed:!hidden.result&&result.result?.winnerUserId==="test-a"});}
    const tie=await this.start(tenant,user,pkg);const b=await this.act(tenant,user,tie.id,"b","accept"),a=this.view(tenant,user,tie.id,"a");checks.push({name:"Independent grids",passed:JSON.stringify(a.options)!==JSON.stringify(b.options)});const label=a.options![0]!.label;await this.act(tenant,user,tie.id,"a","choose",1);const locked=await this.act(tenant,user,tie.id,"a","choose",2);const replay=await this.act(tenant,user,tie.id,"b","choose",b.options!.find(o=>o.label===label)!.index);checks.push({name:"Choice locks; ties start a fresh round",passed:locked.locked&&replay.round===2&&!replay.locked});
    const declined=await this.start(tenant,user,pkg);checks.push({name:"Decline",passed:(await this.act(tenant,user,declined.id,"b","decline")).state==="declined"});
    const expired=await this.start(tenant,user,pkg);checks.push({name:"Expiry",passed:(await this.act(tenant,user,expired.id,"a","expire")).state==="expired"});
    const passed=checks.every(c=>c.passed);await this.emit(tenant,roomId,checks.map(c=>`${c.passed?"PASS":"FAIL"}: ${c.name}`).join("\n"),`flow-tests:${randomUUID()}`);return{passed,checks,roomId};
  }
}
