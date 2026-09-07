import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StreamWeaverFlowTestRoom } from "../apps/streamweaver/dist/flow-test-room.js";
import { flowAuthorTools } from "../apps/streamweaver/dist/flow-author-worker.js";

const actor={id:"owner",displayName:"M.T."};
const guide={summary:"Generated flow test",invariants:["Run only after the configured command matches."],sections:[
  {id:"configuration",title:"Configuration",content:"Review command access, destinations, and device names before enabling."},
  {id:"troubleshooting",title:"Troubleshooting",content:"Use the Flow Builder shadow room and inspect each step result."},
  {id:"tests",title:"Tests",content:"The primary command completes with capture-only external transports."},
]};
function flow(id,name,actions,command={}){return{schemaVersion:1,kind:"streamweaver.flow-package",installUnit:"flow",packageId:`flow.e2e.${id}`,packageKind:"command_flow",visibility:"private",name,description:name,collection:"E2E",tags:["e2e"],author:actor,createdAt:"2026-09-07T00:00:00.000Z",updatedAt:"2026-09-07T00:00:00.000Z",commands:[{id:`command.${id}`,trigger:`!${id}`,aliases:[],role:"primary",required:true,actionIds:actions.map(action=>action.id),family:"custom",cooldownSeconds:0,matcher:"command",runtime:"flow",enabled:true,...command}],actions,guide};}
const action=(id,type,config)=>({id,type,enabled:true,config});

const cases=[
  {
    request:"Make !welcome greet the viewer and tell them how many letters are in their display name.",
    package:flow("welcome","Personal welcome",[action("reply","send-chat",{text:"Welcome %userName%! Your display name has {{= userName | length }} characters."})]),
  },
  {
    request:"When I type !brb, switch Studio PC to the BRB scene, wait two seconds, then hide Webcam in that scene.",
    package:flow("brb","BRB scene sequence",[
      action("scene","obs-scene",{deviceId:"studio-pc",sceneName:"BRB"}),
      action("pause","wait",{milliseconds:2000}),
      action("camera","obs-source",{deviceId:"studio-pc",sceneName:"BRB",sourceName:"Webcam",visible:false}),
      action("reply","send-chat",{text:"BRB scene is ready."}),
    ],{minimumRole:"moderator"}),
  },
  {
    request:"Build !askship so Stellar answers the question, Athena speaks the answer, and the answer is also posted in chat.",
    package:flow("askship","Ask and speak",[
      action("answer","ai-response",{input:"Answer this viewer clearly: %args%",saveAs:"answer"}),
      action("speak","speak",{text:"{{answer}}",voice:"deepgram:aura-2:athena"}),
      action("reply","send-chat",{text:"{{answer}}"}),
    ]),
  },
  {
    request:"Make !liveshoutouts read Discord Stream Hub's live shoutouts and summarize the result in Twitch chat.",
    package:flow("liveshoutouts","Live shoutout lookup",[
      action("lookup","run-action",{action:"dsh.shoutouts.live.read",args:{},saveAs:"shoutouts",sendResult:false}),
      action("reply","send-chat",{text:"Live DSH shoutouts: {{shoutouts}}"}),
    ],{minimumRole:"member"}),
  },
  {
    request:"Create !rps that challenges the first mentioned viewer; both players choose privately and ties replay without revealing early.",
    package:flow("rps","Private rock paper scissors",[action("game","run-native",{
      capability:"streamweaver.donor-command.v1",donorId:"secure-choice-session",title:"Rock Paper Scissors",target:"first-mention",expiresSeconds:180,
      options:[{id:"rock",label:"Rock"},{id:"paper",label:"Paper"},{id:"scissors",label:"Scissors"}],
      relations:[{winner:"rock",loser:"scissors",message:"Rock crushes scissors."},{winner:"scissors",loser:"paper",message:"Scissors cut paper."},{winner:"paper",loser:"rock",message:"Paper covers rock."}],
    })]),
  },
];

test("realistic human flow requests validate, shadow-test, and submit through Stella's tools",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"streamweaver-flow-author-e2e-")),events=[];
  const room=new StreamWeaverFlowTestRoom(directory,{publishSimulationRoomEvent:async(...args)=>{events.push(args);return{};}});
  try{
    for(const entry of cases){
      let submitted;
      const tools=flowAuthorTools(undefined,actor,value=>{submitted=value;},pkg=>room.test("tenant",actor.id,pkg));
      const packageJson=JSON.stringify(entry.package);
      assert.deepEqual(await tools.find(tool=>tool.name==="validate_flow").run({packageJson}),{valid:true},entry.request);
      const shadow=await tools.find(tool=>tool.name==="run_shadow_tests").run({packageJson});
      assert.equal(shadow.passed,true,entry.request+"\n"+JSON.stringify(shadow));
      assert.deepEqual(await tools.find(tool=>tool.name==="submit_flow").run({packageJson}),{accepted:true},entry.request);
      assert.equal(submitted.name,entry.package.name,entry.request);
    }
    assert.ok(events.length>=cases.length);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
