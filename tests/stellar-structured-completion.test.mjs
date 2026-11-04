import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAiCompatibleChatProvider,looksIncompleteCompletion} from '../apps/stellar-core/dist/worker.js';

test('complete flow JSON is returned intact without prose continuation',async()=>{
  const text=JSON.stringify({kind:'streamweaver.flow-package',description:'x'.repeat(250),actions:[]});
  let calls=0;
  const provider=new OpenAiCompatibleChatProvider({origin:'http://127.0.0.1:8081',model:'test',fetchImpl:async()=>{calls++;return Response.json({choices:[{message:{content:text},finish_reason:'stop'}]});}});
  assert.equal((await provider.complete([{role:'user',content:'Return one flow JSON object'}])).text,text);
  assert.equal(calls,1);
  assert.equal(looksIncompleteCompletion('```json\n'+text+'\n```','stop'),false);
  assert.equal(looksIncompleteCompletion(text.slice(0,-1),'stop'),true);
  assert.equal(looksIncompleteCompletion(text,'length'),true);
  assert.equal(looksIncompleteCompletion('Unfinished sentence '.repeat(20),'stop'),true);
});
