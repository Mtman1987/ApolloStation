import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayScene,createOverlaySource,mergeOverlaySceneEdits} from '../apps/spacemountain/dist/overlay-scenes.js';
import {OverlayBayParityController} from '../apps/spacemountain/dist/overlay-bay-ui.js';
const root={querySelector(){return null},querySelectorAll(){return []}};
function fixture(){const scene=createOverlayScene('Personal'),alert={...createOverlaySource('alert','Alerts'),id:'alerts',x:0,y:0,width:25,height:25},chat={...createOverlaySource('widget','Chat'),id:'chat',x:70,y:0,width:25,height:25,zIndex:1};scene.sources=[alert,chat];return{scene,alert,chat,snapshot:{tenantId:'tenant-a',workspace:{revision:1,activePersonalOverlaySceneId:scene.id,activePublicOverlaySceneId:scene.id,overlayScenes:[scene]},apps:[],session:{scopes:['workspace:write','overlay:outputs:write']}}};}

test('dragging and resizing target the grabbed source even when another source was selected',()=>{
 const f=fixture(),ui=new OverlayBayParityController(root,f.snapshot);ui.queueSave=()=>{};ui.render=()=>{};ui.selectedSourceId='chat';
 const node={dataset:{obSource:'alerts'},style:{},setPointerCapture(){},hasPointerCapture(){return false}},bay={querySelector(){return{getBoundingClientRect(){return{width:1000,height:500}}}}};
 ui.drag(node,bay);node.onpointerdown({pointerId:1,clientX:0,clientY:0,preventDefault(){},target:{hasAttribute(){return false}}});
 node.onpointermove({clientX:100,clientY:50});node.onpointerup();
 assert.equal(ui.scenes[0].sources[0].x,10);assert.equal(ui.scenes[0].sources[0].y,10);assert.equal(ui.scenes[0].sources[1].x,70);assert.equal(ui.scenes[0].sources[1].y,0);
 ui.selectedSourceId='chat';node.onpointerdown({pointerId:2,clientX:0,clientY:0,preventDefault(){},target:{hasAttribute(){return true}}});node.onpointermove({clientX:100,clientY:50});node.onpointerup();
 assert.equal(ui.scenes[0].sources[0].width,35);assert.equal(ui.scenes[0].sources[1].width,25);
});

test('background workspace updates preserve an unfinished layout and save rebases unrelated source edits',async t=>{
 const f=fixture(),ui=new OverlayBayParityController(root,f.snapshot);ui.queueSave=()=>{};ui.updateSource('alerts',{x:5,y:8});
 const remote=structuredClone(f.snapshot);remote.workspace.revision=2;remote.workspace.overlayScenes[0].sources[1].x=60;remote.workspace.personalOverlayEnabled=false;
 ui.update(remote);assert.equal(ui.scenes[0].sources[0].x,5);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let stored;
 globalThis.fetch=async(_url,options)=>{if(options.method==='PATCH'){const request=JSON.parse(options.body);assert.equal(request.expectedRevision,2);stored={...remote.workspace,...request.patch,revision:3};return Response.json(stored)}return Response.json(remote.workspace)};
 await ui.persist(false);assert.equal(stored.overlayScenes[0].sources[0].x,5);assert.equal(stored.overlayScenes[0].sources[0].y,8);assert.equal(stored.overlayScenes[0].sources[1].x,60);assert.equal(stored.personalOverlayEnabled,false);assert.equal(ui.editVersion,ui.savedVersion);
});

test('rebasing overlay edits retains new remote sources and independent configuration fields',()=>{
 const {scene}=fixture(),local=structuredClone([scene]),remote=structuredClone([scene]);local[0].sources[0].opacity=.5;local[0].sources[1].config={widgetId:'chat',theme:'blue'};remote[0].sources[1].config={rendererUrl:'https://renderer.example/chat'};remote[0].sources.push({...createOverlaySource('text','Clock'),zIndex:2});
 const merged=mergeOverlaySceneEdits([scene],local,remote);assert.equal(merged[0].sources.length,3);assert.equal(merged[0].sources[0].opacity,.5);assert.deepEqual(merged[0].sources[1].config,{widgetId:'chat',theme:'blue',rendererUrl:'https://renderer.example/chat'});
});
