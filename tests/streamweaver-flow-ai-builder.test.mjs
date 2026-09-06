import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStreamWeaverAiFlowPrompt} from '../apps/streamweaver/dist/flow-ai-builder.js';

test('Stellar flow-coder prompt is sourced from Apollo tools and teaches branches, AI, devices, Flow Code and secure choices',()=>{
  const prompt=buildStreamWeaverAiFlowPrompt('make a smart command',{devices:[{deviceId:'companion-main',kind:'companion',capabilities:['obs.scene','media.playback']}],connections:[{provider:'discord',connectionId:'discord-main',channelId:'chat'}]});
  for(const value of ['condition{left,operator,right}','ai-response{input,saveAs?}','obs-source{deviceId,sceneName,sourceName,visible}','hmo.media.request','dsh.shoutouts.post','sw.image.generate','clip=!clip','media.volume.set:media.playback','companion-main:companion','discord:discord-main:chat','{{= argsText | trim | upper }}','donorId=secure-choice-session','relations=[{winner,loser,message}]','identity-locks each seat']) assert.ok(prompt.includes(value),`missing ${value}`);
  assert.match(prompt,/Never emit http-request or execute-code/);
  assert.match(prompt,/source of truth/i);
  assert.equal(prompt.includes('!__securechoice'),false,'internal secure-choice trigger leaked into the AI tool list');
});

test('the complete Apollo tool catalog fits the Stellar developer message budget with a maximum idea',()=>{
  const prompt=buildStreamWeaverAiFlowPrompt('x'.repeat(4000));
  assert.ok(prompt.length<=8000,`prompt length was ${prompt.length}`);
});
