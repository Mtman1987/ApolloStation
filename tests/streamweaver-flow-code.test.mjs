import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFlowCodeValue,renderFlowCodeExpression} from '../apps/streamweaver/dist/flow-code.js';
import {renderFlowTemplate} from '../apps/streamweaver/dist/flow-runtime.js';

const context={message:'!shape 42 hello',args:['42','hello'],userName:'Commander',user:'commander',targetUser:'captain',lastOutput:'previous',vars:{count:'5',fallback:''}};

test('Flow Code provides deterministic pure transforms and math without JavaScript execution',()=>{
  assert.equal(renderFlowCodeExpression('argsText | trim | upper',context),'42 HELLO');
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
  const message={schemaVersion:1,tenantId:'tenant',provider:'twitch',connectionId:'main',channelId:'chat',messageId:'one',text:'!shape 2 world',occurredAt:'2026-09-06T00:00:00Z',actor:{providerUserId:'one',username:'commander',displayName:'Commander',isBot:false,roles:['broadcaster']},mentions:[]};
  assert.equal(renderFlowTemplate('Result: {{= argsText | upper }}',message,{lastOutput:''}),'Result: 2 WORLD');
  assert.equal(renderFlowTemplate('{{= vars.points | number | add(args[0]) }}',message,{points:'4'}),'6');
});
