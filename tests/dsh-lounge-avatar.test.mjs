import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDshStellaAvatarRenderPlan, DSH_STELLA_ROBOT_ATLAS, DshStellaGestureBag } from '../apps/discord-stream-hub/dist/lounge-avatar.js';

const canonical = DSH_STELLA_ROBOT_ATLAS.canonical;

test('Stella idle and talking are 30fps ping-pong loops returning to canonical frame 1',()=>{
 for(const state of ['idle','talking']){
  const plan=buildDshStellaAvatarRenderPlan(state);
  assert.equal(plan.fps,30);assert.equal(plan.loop,true);
  assert.deepEqual(plan.frames[0],canonical);assert.deepEqual(plan.frames.at(-1),canonical);
  assert.ok(plan.frames.length>DSH_STELLA_ROBOT_ATLAS.states[state].frames,'persistent state contains reverse frames');
 }
});

test('Stella gestures play once from canonical frame 1 and end on canonical frame 1',()=>{
 for(const state of ['wave','jump','waiting','working','running-right','running-left','failed','look-a','look-b']){
  const plan=buildDshStellaAvatarRenderPlan(state);
  assert.equal(plan.loop,false);assert.equal(plan.fps,30);
  assert.deepEqual(plan.frames[0],canonical);assert.deepEqual(plan.frames.at(-1),canonical);
 }
});

test('Stella weighted random gestures do not starve unseen motions',()=>{
 const bag=new DshStellaGestureBag(()=>0),pool=['wave','jump','waiting'];
 const seen=new Set(Array.from({length:3},()=>bag.next(pool)));
 assert.deepEqual([...seen].sort(),[...pool].sort());
});
