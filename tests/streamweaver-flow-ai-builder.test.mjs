import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStreamWeaverAiFlowPrompt,buildStreamWeaverAiFlowRepairPrompt,STREAMWEAVER_AI_FLOW_IDEA_LIMIT} from '../apps/streamweaver/dist/flow-ai-builder.js';

test('Stellar flow-coder prompt is sourced from Apollo tools and teaches branches, AI, devices, Flow Code and secure choices',()=>{
  const prompt=buildStreamWeaverAiFlowPrompt('make a smart command',{devices:[{deviceId:'companion-main',kind:'companion',capabilities:['obs.scene','media.playback']}],connections:[{provider:'discord',connectionId:'discord-main',channelId:'chat'}]});
  for(const value of ['condition{left,operator,right}','ai-response{input,saveAs?}','obs-source{deviceId,sceneName,sourceName,visible}','hmo.media.request','dsh.shoutouts.post','sw.image.generate','clip=!clip','media.volume.set:media.playback','companion-main:companion','discord:discord-main:chat','{{= argsText | trim | upper }}','donorId=secure-choice-session','relations=[{winner,loser,message}]','identity-locks each seat']) assert.ok(prompt.includes(value),`missing ${value}`);
  assert.match(prompt,/Never emit http-request or execute-code/);
  assert.match(prompt,/source of truth/i);
  assert.equal(prompt.includes('!__securechoice'),false,'internal secure-choice trigger leaked into the AI tool list');
});

test('failed Stellar drafts receive bounded validator-guided repair instructions',()=>{
  const original=buildStreamWeaverAiFlowPrompt('make !duel a secure simultaneous game');
  const repair=buildStreamWeaverAiFlowRepairPrompt(original,'```json\n{"actions":[]}\n```',new Error('Primary command has no runnable entry action'));
  assert.match(repair,/regenerate the complete package from scratch/i);
  assert.match(repair,/Primary command has no runnable entry action/);
  assert.match(repair,/"actions":\[\]/);
  assert.ok(repair.length<=7900);
});

test('repair retains the requested game even when the tool catalog exceeds the repair excerpt',()=>{
  const idea='Build !rpsls with private simultaneous choices. '+ 'Keep the game rules. '.repeat(60);
  const original=buildStreamWeaverAiFlowPrompt(idea);
  assert.ok(original.length>6000);
  const repair=buildStreamWeaverAiFlowRepairPrompt(original,'{}',new Error('Missing action capability'));
  assert.ok(repair.includes(`User request: ${idea}`));
  assert.ok(repair.includes('capability:streamweaver.donor-command.v1'));
});

test('the complete Apollo tool catalog fits the Stellar developer message budget with a maximum idea',()=>{
  const devices=Array.from({length:40},(_,i)=>({deviceId:`companion-${i}-${'x'.repeat(100)}`,kind:'companion',capabilities:Array(20).fill('media.playback')}));
  const connections=Array.from({length:40},(_,i)=>({provider:'discord',connectionId:`connection-${i}-${'x'.repeat(100)}`,channelId:'chat'}));
  const prompt=buildStreamWeaverAiFlowPrompt('x'.repeat(STREAMWEAVER_AI_FLOW_IDEA_LIMIT),{devices,connections});
  assert.ok(prompt.length<=8000,`prompt length was ${prompt.length}`);
  assert.throws(()=>buildStreamWeaverAiFlowPrompt('x'.repeat(STREAMWEAVER_AI_FLOW_IDEA_LIMIT+1)),/at most/i);
});
