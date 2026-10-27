function renderBaseAvatarStudioPage(nonce: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>Overlay Bay · Avatar Studio</title><style>
:root{color-scheme:dark;font:14px system-ui;color:#edf4ff;background:#070b14}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}#room{position:fixed;inset:0;background:radial-gradient(ellipse at 50% 65%,#202943 0,#0b1221 42%,#05070d 100%)}canvas{display:block;width:100%;height:100%}#hint{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:8px 12px;border:1px solid #ffffff20;border-radius:30px;background:#080d18a8;color:#b9c9e8;pointer-events:none}#editor{position:absolute;inset:12px;display:grid;grid-template-columns:minmax(190px,260px) 1fr minmax(220px,300px);gap:10px;pointer-events:none}#editor[hidden]{display:none}.panel{pointer-events:auto;overflow:auto;max-height:100%;border:1px solid #7e9bc84a;border-radius:14px;background:#08101fe8;backdrop-filter:blur(18px);padding:14px;box-shadow:0 12px 45px #0008}.panel h2{font-size:16px;margin:0 0 12px}.panel p{color:#aabbd7;font-size:12px;line-height:1.45}label{display:grid;gap:5px;margin:10px 0;color:#c7d5eb;font-size:12px}input,select,button{font:inherit;color:#eef5ff;background:#131f33;border:1px solid #4b6386;border-radius:8px;padding:9px;max-width:100%;width:100%}input[type=file]{font-size:11px}button{cursor:pointer}button.primary{background:#573dd0;border-color:#a69aff}button:disabled{opacity:.5}#toolbar{display:flex;gap:7px;flex-wrap:wrap}#toolbar button{width:auto}#status{font-size:11px;color:#9ec7ff;overflow-wrap:anywhere}.cliprow{display:flex;gap:6px;align-items:center}.cliprow select{flex:1;min-width:0}.cliprow button{width:auto}.rule{border-top:1px solid #ffffff18;margin:14px 0;padding-top:10px}.ghost{position:absolute;top:14px;right:14px;pointer-events:auto;width:auto;z-index:3;background:#0a1220b8}body.clean #hint{opacity:.4}@media(max-width:800px){#editor{grid-template-columns:1fr 1fr;inset:8px;overflow:auto}#editor .panel:last-child{grid-column:1/-1;max-height:35vh}#editor .panel{max-height:46vh;padding:10px}#editor .panel:nth-child(2){display:none}#hint{font-size:11px;white-space:nowrap;bottom:8px}}
</style></head><body><main id="room" aria-label="3D avatar preview room"></main><button id="toggle" class="ghost" type="button">Open Avatar Studio</button><div id="hint">Clean preview · tap the room to open controls</div><section id="editor" hidden aria-label="Avatar Studio controls">
<aside class="panel"><h2>Model library</h2><label>Upload rigged model (GLB)<input id="modelFile" type="file" accept=".glb,model/gltf-binary"></label><label>Model<select id="modelSelect"><option value="current">Current model / uploaded GLB</option><option value="male-body">Generic male body · editable</option><option value="female-body">Generic female body · editable</option><option value="commissioned">Commissioned finished model · view only</option></select></label><button id="loadLibraryModel" type="button">Load selected library model</button><p>Generic bodies are separate starting models. The commissioned finished model is opened in a view-only path and is not rebuilt, rigged, or altered.</p><div id="modelInfo" class="rule"><p>Upload a GLB to preview it in this room. Select a GLB, preview and edit its motions, then save it to StreamWeaver for direct rigging and activation.</p></div><div id="toolbar"><button id="reset" type="button">Reset camera</button><button id="pause" type="button">Pause</button></div></aside>
<aside class="panel"><h2>3D preview</h2><p>Drag to orbit · scroll/pinch to zoom. Animation playback continues when controls are hidden.</p><div id="status" role="status">Preparing 3D renderer…</div><div class="cliprow"><button id="exportCombinedGlb" type="button">Export model + imported clips</button><button id="rigActivate3d" class="primary" type="button">Rig &amp; activate 3D avatar</button></div><p>Imported animation clips are attached to the exported GLB before upload, rather than remaining only in this browser preview.</p><p>Embedded clips, imported GLBs, and the shared retargetable motion library use one selector. Cross-rig imports are retargeted when the rig passes the library coverage check.</p><div class="rule"><h2>Model fit tweaks</h2><label>Model/head scale<input id="avatarTweakScale" type="range" min="0.6" max="1.4" step="0.01" value="1"></label><label>Vertical offset<input id="avatarTweakY" type="range" min="-0.5" max="0.5" step="0.01" value="0"></label><label>Depth offset<input id="avatarTweakZ" type="range" min="-0.5" max="0.5" step="0.01" value="0"></label><label>Facial movement intensity<input id="avatarTweakMorph" type="range" min="0" max="2" step="0.05" value="1"></label><button id="resetAvatarTweaks" type="button">Reset fit tweaks</button><p>These controls are based on the ZIP’s TweakControls module. Transform changes are included when you export or rig the model.</p></div><div class="rule"><h2>Retargetable motion library</h2><button id="loadMotionLibrary" type="button">Load shared humanoid motions</button><p>Loads reusable idle, walk and wave clips; retargets them to this avatar and reports skeleton coverage.</p><h2>Uploaded motion references</h2><div id="referenceMotions"></div></div></aside>
<aside class="panel"><h2>Unified animation library</h2><label>Import animation GLB/GLTF<input id="animationFile" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></label><label>Animation<select id="clipSelect"><option value="">No clips loaded</option></select></label><div class="cliprow"><button id="play" class="primary" type="button">Play selected</button><button id="stop" type="button">Stop</button></div><div class="rule"><h2>Trigger assignments</h2><label>Trigger source<select id="triggerSource"><option>AI command</option><option>AI speaking</option><option>Twitch follow</option><option>Subscription</option><option>Raid</option><option>Channel Point redemption</option><option>Chat command</option><option>Manual</option></select></label><label>Trigger name<input id="triggerName" value="bow_gesture" placeholder="e.g. bow_gesture, !dance"></label><label>Animation for trigger<select id="triggerClip"></select></label><label>Playback behavior<select id="triggerBehavior"><option>Play once</option><option>Loop until stopped</option><option>Play while speaking</option></select></label><button id="addTrigger" type="button">Add trigger mapping</button><div id="triggerList"></div><p>Mappings are a local test draft in this first pass. Production event ingestion and durable storage are a separate integration step.</p></div></aside></section>
<script type="importmap" nonce="${nonce}">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script><script type="module" nonce="${nonce}">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationManager, parseClipJSON, retargetClipToObject } from 'https://cdn.jsdelivr.net/npm/@three-ws/retarget@0.1.1/+esm';
const room=document.querySelector('#room'),editor=document.querySelector('#editor'),toggle=document.querySelector('#toggle'),hint=document.querySelector('#hint'),status=document.querySelector('#status');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080d18);scene.fog=new THREE.Fog(0x080d18,9,28);
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,100);camera.position.set(0,1.5,5.4);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;room.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc4d8ff,0x242033,2));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,6,4);scene.add(key);const rim=new THREE.PointLight(0x725cff,24,12);rim.position.set(-3,2,0);scene.add(rim);
const floor=new THREE.Mesh(new THREE.CircleGeometry(8,64),new THREE.MeshStandardMaterial({color:0x111b2c,metalness:.3,roughness:.7}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);const grid=new THREE.GridHelper(16,32,0x32466a,0x1a2941);grid.position.y=0;scene.add(grid);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.enableDamping=true;const loader=new GLTFLoader();let avatar=null,mixer=null,activeAction=null,paused=false,clips=[],modelUrl=null,animationUrls=[],triggers=[],motionManager=null,currentModelFile=null,currentModelPurpose='upload'; const referenceMotions=['Formal_Bow.gif','FunnyDancing_01.gif','Chair_Sit_Idle_M.gif','Big_Wave_Hello.gif','Confused_Scratch.gif','Discuss_While_Moving.gif','Dodge_and_Counter.gif','Call_Gesture.gif','Dozing_Elderly.gif'];
const clipSelect=document.querySelector('#clipSelect'),triggerClip=document.querySelector('#triggerClip'),modelInfo=document.querySelector('#modelInfo');
class TweakControls {
  constructor(){this.state={headScale:1,headOffsetY:0,headOffsetZ:0,morphIntensity:1};this.listeners=[];}
  set(key,value){if(key in this.state){this.state[key]=value;this.listeners.forEach(fn=>fn(this.getState()));}}
  onChange(fn){this.listeners.push(fn);return()=>{this.listeners=this.listeners.filter(listener=>listener!==fn);};}
  getState(){return{...this.state};}
  toJSON(){return this.getState();}
}
const tweakControls=new TweakControls();
let baseModelScale=1,baseModelPosition=new THREE.Vector3();
function applyAvatarTweaks(){if(!avatar||currentModelPurpose==='finished')return;const state=tweakControls.getState();avatar.scale.setScalar(baseModelScale*state.headScale);avatar.position.copy(baseModelPosition);avatar.position.y+=state.headOffsetY;avatar.position.z+=state.headOffsetZ;}
tweakControls.onChange(applyAvatarTweaks);
function updateClips(){clipSelect.replaceChildren();triggerClip.replaceChildren();clips.forEach((entry,i)=>{const o=new Option(entry.name+' · '+entry.source,String(i));clipSelect.add(o);triggerClip.add(new Option(entry.name,String(i)))});if(!clips.length){clipSelect.add(new Option('No clips loaded',''));triggerClip.add(new Option('No clips loaded',''))}}
function clearAvatar(){if(avatar){scene.remove(avatar);avatar.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose())}})}avatar=null;mixer=null;activeAction=null;clips=[];updateClips()}
function loadModel(file){if(!/\\.glb$/i.test(file.name)){status.textContent='Please upload a single-file GLB model. A .gltf file may depend on external binary or texture files.';return}currentModelPurpose='upload';currentModelFile=file;for(const id of ['avatarTweakScale','avatarTweakY','avatarTweakZ'])document.querySelector('#'+id).disabled=false;document.querySelector('#resetAvatarTweaks').disabled=false;document.querySelector('#rigActivate3d').disabled=false;const url=URL.createObjectURL(file);if(modelUrl)URL.revokeObjectURL(modelUrl);modelUrl=url;loader.load(url,g=>{clearAvatar();avatar=g.scene;scene.add(avatar);const box=new THREE.Box3().setFromObject(avatar),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());avatar.position.x-=center.x;avatar.position.z-=center.z;avatar.position.y-=box.min.y;const scale=2.1/Math.max(size.y,.01);baseModelScale=scale;baseModelPosition.copy(avatar.position);avatar.scale.setScalar(scale);applyAvatarTweaks();mixer=new THREE.AnimationMixer(avatar);clips=g.animations.map(c=>({name:c.name||'Animation '+(clips.length+1),clip:c,source:'embedded'}));motionManager=new AnimationManager();try{motionManager.attach(avatar)}catch{}updateClips();modelInfo.innerHTML='<p><b>'+escapeHtml(file.name)+'</b><br>'+g.animations.length+' embedded animation(s) · '+Math.round(file.size/1024)+' KB</p>';status.textContent='Model loaded. '+g.animations.length+' embedded clip(s) found.';document.querySelector('#modelSelect').add(new Option(file.name,String(Date.now())));},undefined,e=>{status.textContent='Model load failed: '+(e?.message||'unknown error')})}
const libraryModels={
 'male-body':{label:'Generic male body',url:'https://raw.githubusercontent.com/Mtman1987/3davatar/main/male-base-mesh-base_male.glb',filename:'male-base-mesh-base_male.glb',purpose:'body'},
 'female-body':{label:'Generic female body',url:'https://raw.githubusercontent.com/Mtman1987/3davatar/main/female-base-mesh-base_female.glb',filename:'female-base-mesh-base_female.glb',purpose:'body'},
 'commissioned':{label:'Commissioned finished model',url:'https://raw.githubusercontent.com/Mtman1987/3davatar/main/Meshy_AI_Neon_Lock_In_Gamer_All_Animations%20(1).glb',filename:'commissioned-finished-model.glb',purpose:'finished'}
};
async function loadLibraryModel(){
 const selected=document.querySelector('#modelSelect').value,def=libraryModels[selected];
 if(!def){status.textContent='Choose a library model first.';return}
 const button=document.querySelector('#loadLibraryModel');button.disabled=true;status.textContent='Loading '+def.label+'…';
 try{
  const response=await fetch(def.url,{mode:'cors',cache:'force-cache'});
  if(!response.ok)throw new Error('Model download failed (HTTP '+response.status+').');
  const blob=await response.blob();
  if(blob.size<12)throw new Error('The model file is empty or incomplete.');
  const file=new File([blob],def.filename,{type:'model/gltf-binary'});
  const url=URL.createObjectURL(file);
  loader.load(url,g=>{
   clearAvatar();if(modelUrl)URL.revokeObjectURL(modelUrl);modelUrl=url;currentModelPurpose=def.purpose==='finished'?'finished':'body';currentModelFile=currentModelPurpose==='finished'?null:file;
   avatar=g.scene;scene.add(avatar);
   const box=new THREE.Box3().setFromObject(avatar),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
   baseModelScale=1;baseModelPosition.copy(avatar.position);if(def.purpose!=='finished')avatar.scale.setScalar(1);
   controls.target.copy(center);const distance=Math.max(size.x,size.y,size.z,1)*2.5;camera.position.set(center.x,center.y+size.y*.18,center.z+distance);camera.lookAt(center);controls.update();
   mixer=new THREE.AnimationMixer(avatar);clips=g.animations.map((c,i)=>({name:c.name||'Animation '+(i+1),clip:c,source:'embedded'}));motionManager=new AnimationManager();try{motionManager.attach(avatar)}catch{}updateClips();
   const info=document.querySelector('#modelInfo');info.innerHTML='<p><b>'+escapeHtml(def.label)+'</b><br>'+Math.round(blob.size/1024)+' KB'+(currentModelPurpose==='finished'?'<br>View-only: the commissioned model is loaded without geometry edits, scaling, repositioning, or rigging.':'<br>Generic body loaded as a separate starting model.')+'</p>';
   for(const id of ['avatarTweakScale','avatarTweakY','avatarTweakZ'])document.querySelector('#'+id).disabled=currentModelPurpose==='finished';
   document.querySelector('#resetAvatarTweaks').disabled=currentModelPurpose==='finished';
   rig3dButton.disabled=currentModelPurpose==='finished';
   status.textContent=def.label+' loaded'+(currentModelPurpose==='finished'?' in view-only mode.':' as an editable body model.');
  },undefined,e=>{URL.revokeObjectURL(url);status.textContent='Model load failed: '+(e?.message||'unknown error')});
 }catch(error){status.textContent=error?.message||'Could not load library model.'}
 finally{button.disabled=false}
}
document.querySelector('#loadLibraryModel').addEventListener('click',loadLibraryModel);
function loadAnimation(file){const url=URL.createObjectURL(file);animationUrls.push(url);loader.load(url,g=>{if(!avatar){status.textContent='Load a target model first, then import animation clips.';return}const added=[];const rejected=[];for(const sourceClip of g.animations){try{const result=retargetClipToObject(sourceClip,avatar);if(result.clip)added.push({name:sourceClip.name||file.name,clip:result.clip,source:file.name,coverage:result.coverage});else rejected.push((sourceClip.name||file.name)+' ('+Math.round((result.coverage||0)*100)+'% bone coverage)')}catch(error){rejected.push((sourceClip.name||file.name)+' ('+(error?.message||'retarget failed')+')')}}clips.push(...added);updateClips();status.textContent='Retargeted '+added.length+' clip(s) from '+file.name+'.'+(rejected.length?' Skipped '+rejected.length+' incompatible clip(s): '+rejected.slice(0,3).join(', '):'')},undefined,e=>status.textContent='Animation import failed: '+(e?.message||'unknown error'))}
function playIndex(i,loop='once'){if(!mixer||!clips[i])return;const entry=clips[i];if(activeAction){activeAction.stop();mixer.uncacheAction(activeAction.getClip(),avatar)}activeAction=mixer.clipAction(entry.clip);activeAction.reset();const shouldLoop=loop==='repeat'||entry.loop===true;activeAction.setLoop(shouldLoop?THREE.LoopRepeat:THREE.LoopOnce,shouldLoop?Infinity:1);activeAction.clampWhenFinished=loop!=='repeat';activeAction.play();status.textContent='Playing '+entry.name+' ('+entry.source+')'}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function setEditor(open){editor.hidden=!open;toggle.textContent=open?'Hide controls':'Open Avatar Studio';hint.textContent=open?'Click outside the control panels to hide the editor':'Clean preview · tap the room to open controls';document.body.classList.toggle('clean',!open)}
toggle.addEventListener('click',e=>{e.stopPropagation();setEditor(editor.hidden)});room.addEventListener('click',()=>{setEditor(editor.hidden)});editor.addEventListener('click',e=>e.stopPropagation());document.querySelectorAll('.panel').forEach(p=>p.addEventListener('click',e=>e.stopPropagation()));
function syncAvatarTweaks(){tweakControls.set('headScale',Number(document.querySelector('#avatarTweakScale').value));tweakControls.set('headOffsetY',Number(document.querySelector('#avatarTweakY').value));tweakControls.set('headOffsetZ',Number(document.querySelector('#avatarTweakZ').value));tweakControls.set('morphIntensity',Number(document.querySelector('#avatarTweakMorph').value));}
for(const id of ['avatarTweakScale','avatarTweakY','avatarTweakZ','avatarTweakMorph'])document.querySelector('#'+id).addEventListener('input',syncAvatarTweaks);
document.querySelector('#resetAvatarTweaks').addEventListener('click',()=>{document.querySelector('#avatarTweakScale').value='1';document.querySelector('#avatarTweakY').value='0';document.querySelector('#avatarTweakZ').value='0';document.querySelector('#avatarTweakMorph').value='1';syncAvatarTweaks()});
document.querySelector('#modelFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)loadModel(f)});document.querySelector('#animationFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)loadAnimation(f)});document.querySelector('#play').addEventListener('click',()=>playIndex(Number(clipSelect.value)));document.querySelector('#stop').addEventListener('click',()=>{if(activeAction)activeAction.stop();activeAction=null});document.querySelector('#pause').addEventListener('click',e=>{paused=!paused;e.target.textContent=paused?'Resume':'Pause'});document.querySelector('#reset').addEventListener('click',()=>{camera.position.set(0,1.5,5.4);controls.target.set(0,1,0);controls.update()});
function renderTriggers(){const list=document.querySelector('#triggerList');list.replaceChildren();triggers.forEach((t,i)=>{const row=document.createElement('p');row.textContent=t.source+' · ['+t.name+'] → '+(clips[t.clip]?.name||'Missing clip')+' · '+t.behavior+' ';const del=document.createElement('button');del.textContent='Remove';del.onclick=()=>{triggers.splice(i,1);renderTriggers()};row.appendChild(del);list.appendChild(row)})}
document.querySelector('#addTrigger').addEventListener('click',()=>{const name=document.querySelector('#triggerName').value.trim(),index=Number(triggerClip.value);if(!name||!clips[index])return;triggers.push({source:document.querySelector('#triggerSource').value,name,clip:index,behavior:document.querySelector('#triggerBehavior').value});renderTriggers()});


document.querySelector('#referenceMotions').innerHTML=referenceMotions.map(name=>'<p><b>'+escapeHtml(name.replace('.gif','').replaceAll('_',' '))+'</b><br><small>GIF reference only — requires a rigged clip conversion before skeletal playback.</small></p>').join('');
document.querySelector('#loadMotionLibrary').addEventListener('click',async()=>{
 if(!avatar||!mixer){status.textContent='Upload the Neon Lock-In Gamer GLB first.';return}
 const defs=[{name:'Library · Idle',url:'https://three.ws/animations/clips/idle.json',loop:true},{name:'Library · Walk',url:'https://three.ws/animations/clips/walk.json',loop:true},{name:'Library · Wave',url:'https://three.ws/animations/clips/wave.json',loop:false}];
 const added=[];
 for(const def of defs){try{const response=await fetch(def.url);if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();const sourceClip=parseClipJSON(data,def.name);const result=retargetClipToObject(sourceClip,avatar);if(result.clip){added.push({name:def.name,clip:result.clip,source:'retargeted library',loop:def.loop,coverage:result.coverage});}else{status.textContent=def.name+' skipped: rig coverage '+Math.round((result.coverage||0)*100)+'% (minimum 50%).';}}catch(error){status.textContent='Could not load '+def.name+': '+(error?.message||'unknown error')}}
 clips.push(...added);updateClips();status.textContent=added.length?'Loaded '+added.length+' retargeted motion(s): '+added.map(x=>x.name.replace('Library · ','')).join(', ')+'.':'No compatible library clips loaded; see coverage/status message.';
});

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
const clock=new THREE.Clock();function frame(){requestAnimationFrame(frame);const dt=clock.getDelta();if(mixer&&!paused)mixer.update(dt);controls.update();renderer.render(scene,camera)}frame();status.textContent='3D room ready. Upload a rigged GLB to begin.';
</script></body></html>`;
}

/**
 * Adds the StreamWeaver avatar source selector to the existing 3D editor.
 * This wrapper intentionally reuses the current renderer and keeps 2D/3D source
 * selection in one page so the browser-source URL remains stable.
 */
export function renderAvatarStudioPage(nonce: string) {
  const html = renderBaseAvatarStudioPage(nonce);
  const panel = `
<aside id="avatarSourcePanel" class="panel">
  <h2>StreamWeaver avatar source</h2>
  <p>Choose the avatar rendered by this studio/browser source. 2D PNG-Tuber images remain supported alongside rigged 3D models.</p>
  <label>Active avatar type<select id="avatarSourceMode"><option value="3d">3D rigged avatar</option><option value="2d">2D PNG-Tuber</option></select></label>
  <label>2D avatar image (PNG/WebP)<input id="pngTuberFile" type="file" accept="image/png,image/webp"></label>
  <label>Optional speaking image (mouth-open PNG/WebP)<input id="pngTuberSpeakingFile" type="file" accept="image/png,image/webp"></label>
  <label>Audio2Face bridge WebSocket URL<input id="audio2FaceUrl" type="url" placeholder="ws://127.0.0.1:8011/avatar"></label>
  <div id="avatarSourcePreview" class="rule" aria-live="polite"><p>No 2D avatar selected. The 3D model remains active.</p></div><div class="cliprow"><button id="savePngTuber" class="primary" type="button">Save 2D avatar to StreamWeaver</button><button id="saveAudio2Face" type="button">Save Audio2Face bridge</button></div><p id="avatarPersistStatus" role="status">Select an avatar type, then save it to the active StreamWeaver browser source.</p>
  <div class="cliprow"><button id="connectAudio2Face" type="button">Connect Audio2Face</button><button id="disconnectAudio2Face" type="button">Disconnect</button></div>
  <p id="audio2FaceStatus" role="status">Audio2Face is not connected. Configure a reachable bridge endpoint to enable live facial updates.</p>
  <p>Bridge messages accepted: JSON objects containing a <code>blendshapes</code> object keyed by ARKit names, or <code>jawOpen</code> / <code>mouthOpen</code> numeric values from 0 to 1. This does not start NVIDIA Audio2Face itself; it connects to a bridge you run.</p>
</aside>`;
  const sectionClose = "</section>";
  const sectionAt = html.indexOf(sectionClose);
  const scriptClose = "</script></body></html>";
  const scriptAt = html.lastIndexOf(scriptClose);
  if (sectionAt < 0 || scriptAt < 0) return html;
  const updated = html.slice(0, sectionAt) + panel + html.slice(sectionAt);
  const adjustedScriptAt = updated.lastIndexOf(scriptClose);
  const bridgeScript = `
/* StreamWeaver source selection and Audio2Face bridge adapter. */
const sourceMode = document.querySelector('#avatarSourceMode');
const pngTuberFile = document.querySelector('#pngTuberFile');
const pngTuberSpeakingFile = document.querySelector('#pngTuberSpeakingFile');
const sourcePreview = document.querySelector('#avatarSourcePreview');
const a2fUrl = document.querySelector('#audio2FaceUrl');
const a2fStatus = document.querySelector('#audio2FaceStatus');
const connectA2F = document.querySelector('#connectAudio2Face');
const disconnectA2F = document.querySelector('#disconnectAudio2Face');
let pngIdleUrl = null, pngSpeakingUrl = null, pngIdleFile = null, pngSpeakingFile = null, a2fSocket = null, pngMouthOpen = false;
const pngLayer = document.createElement('img');
pngLayer.id = 'pngTuberLayer';
pngLayer.alt = 'Selected 2D PNG-Tuber avatar';
pngLayer.hidden = true;
pngLayer.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(72vw,760px);max-height:86vh;object-fit:contain;pointer-events:none;filter:drop-shadow(0 16px 36px #0009);z-index:1';
room.appendChild(pngLayer);
const style = document.createElement('style');
style.textContent = '#room.avatar-mode-2d canvas{opacity:0}#room.avatar-mode-2d{background:transparent}#pngTuberLayer[hidden]{display:none}#avatarSourcePanel{grid-column:1/-1;max-height:31vh}#avatarSourcePanel p{margin:7px 0}#avatarSourcePanel .cliprow button{flex:1}@media(max-width:800px){#avatarSourcePanel{grid-column:1/-1;max-height:35vh}}';
document.head.appendChild(style);
function setAvatarSourceMode() {
  const is2d = sourceMode.value === '2d';
  room.classList.toggle('avatar-mode-2d', is2d);
  pngLayer.hidden = !is2d || !pngIdleUrl;
  if (is2d) setEditor(true);
  sourcePreview.innerHTML = is2d
    ? '<p><b>2D PNG-Tuber active</b><br>' + (pngIdleUrl ? 'Idle and speaking images are ready.' : 'Upload an idle PNG/WebP image to display the 2D avatar.') + '</p>'
    : '<p><b>3D avatar active</b><br>Use the existing rigged GLB loader and animation editor above.</p>';
}
function loadPngSource(file, speaking) {
  if (!file) return;
  if (speaking) {
    pngSpeakingFile = file;
    if (pngSpeakingUrl) URL.revokeObjectURL(pngSpeakingUrl);
    pngSpeakingUrl = URL.createObjectURL(file);
  } else {
    pngIdleFile = file;
    if (pngIdleUrl) URL.revokeObjectURL(pngIdleUrl);
    pngIdleUrl = URL.createObjectURL(file);
    pngLayer.src = pngIdleUrl;
  }
  setAvatarSourceMode();
}
sourceMode.addEventListener('change', setAvatarSourceMode);
pngTuberFile.addEventListener('change', e => loadPngSource(e.target.files?.[0], false));
pngTuberSpeakingFile.addEventListener('change', e => loadPngSource(e.target.files?.[0], true));
const jawBaseRotations = new WeakMap();
function applyA2FMessage(payload) {
  if (!payload || typeof payload !== 'object') return;
  const blendshapes = payload.blendshapes && typeof payload.blendshapes === 'object' ? payload.blendshapes : payload;
  const raw = Number(blendshapes.jawOpen ?? blendshapes.mouthOpen ?? blendshapes.JawOpen ?? 0);
  const mouth = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
  const adjustedMouth = Math.max(0, Math.min(1, mouth * tweakControls.getState().morphIntensity));
  pngMouthOpen = adjustedMouth > 0.18;
  if (sourceMode.value === '2d' && pngLayer && pngIdleUrl) {
    pngLayer.src = pngMouthOpen && pngSpeakingUrl ? pngSpeakingUrl : pngIdleUrl;
    pngLayer.style.transform = 'translate(-50%,-50%) scale(' + (1 + adjustedMouth * 0.025).toFixed(3) + ')';
  }
  if (avatar && currentModelPurpose!=='finished' && blendshapes && typeof blendshapes === 'object') {
    avatar.traverse(node => {
      if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
      for (const [name, value] of Object.entries(blendshapes)) {
        const idx = node.morphTargetDictionary[name];
        if (idx !== undefined && Number.isFinite(Number(value))) node.morphTargetInfluences[idx] = Math.max(0, Math.min(1, Number(value) * tweakControls.getState().morphIntensity));
      }
      for (const key of ['jawOpen', 'mouthOpen', 'JawOpen']) {
        const idx = node.morphTargetDictionary[key];
        if (idx !== undefined) node.morphTargetInfluences[idx] = adjustedMouth;
      }
    });
    avatar.traverse(node => {
      const name = String(node.name || '').toLowerCase();
      if (node.isBone && (name === 'jaw' || name.endsWith(':jaw') || name.endsWith('_jaw'))) {
        if (!jawBaseRotations.has(node)) jawBaseRotations.set(node, node.rotation.x);
        node.rotation.x = jawBaseRotations.get(node) + adjustedMouth * 0.45;
      }
    });
  }
}
connectA2F.addEventListener('click', () => {
  const endpoint = a2fUrl.value.trim();
  if (!endpoint || !/^wss?:\\/\\//i.test(endpoint)) {
    a2fStatus.textContent = 'Enter a valid ws:// or wss:// bridge URL first.';
    return;
  }
  try {
    if (a2fSocket) a2fSocket.close();
    a2fSocket = new WebSocket(endpoint);
    a2fSocket.addEventListener('open', () => { a2fStatus.textContent = 'Connected to Audio2Face bridge: ' + endpoint; });
    a2fSocket.addEventListener('message', event => {
      try { applyA2FMessage(JSON.parse(event.data)); }
      catch { a2fStatus.textContent = 'Connected, but received a non-JSON bridge message.'; }
    });
    a2fSocket.addEventListener('error', () => { a2fStatus.textContent = 'Audio2Face bridge connection error. Check endpoint, network access, and bridge logs.'; });
    a2fSocket.addEventListener('close', () => { a2fStatus.textContent = 'Audio2Face bridge disconnected.'; });
    a2fStatus.textContent = 'Connecting to ' + endpoint + '…';
  } catch (error) { a2fStatus.textContent = 'Could not connect: ' + (error?.message || 'unknown error'); }
});
disconnectA2F.addEventListener('click', () => {
  if (a2fSocket) a2fSocket.close();
  a2fSocket = null;
  a2fStatus.textContent = 'Audio2Face bridge disconnected.';
});
setAvatarSourceMode();

const avatarPersistStatus = document.querySelector('#avatarPersistStatus');
const savePngButton = document.querySelector('#savePngTuber');
const saveAudio2FaceButton = document.querySelector('#saveAudio2Face');
const rig3dButton = document.querySelector('#rigActivate3d');
const exportGlbButton = document.querySelector('#exportCombinedGlb');
const controlRoot = location.pathname.startsWith('/apps/streamweaver') ? '/apps/streamweaver/api/control' : '/api/streamweaver/control';
let cachedControl = null;
function persistStatus(message, error = false) {
  avatarPersistStatus.textContent = message;
  avatarPersistStatus.style.color = error ? '#ff9b9b' : '#9ec7ff';
}
async function controlApi(path = '', body = undefined) {
  const response = await fetch(controlRoot + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? {'accept':'application/json'} : {'content-type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  let value = {};
  try { value = await response.json(); } catch {}
  if (!response.ok) throw new Error(value.message || value.error || ('StreamWeaver request failed (' + response.status + ')'));
  return value;
}
async function tenantControl() {
  cachedControl = await controlApi('');
  if (!cachedControl.tenantId) throw new Error('No active StreamWeaver tenant was returned. Sign in to the correct tenant and reopen Avatar Studio.');
  return cachedControl;
}
function mediaHeaders(tenantId, contentType, idempotencyKey) {
  return {'content-type':contentType,'x-spmt-tenant':tenantId,'x-spmt-app':'streamweaver','idempotency-key':idempotencyKey};
}
async function uploadStudioAsset(file, purpose, contentType, tenantId, publish) {
  const query = new URLSearchParams({name:file.name || (purpose === 'avatar' ? 'png-tuber.png' : 'avatar.glb'),purpose,sourceAppId:'streamweaver'});
  const upload = await fetch('/v1/media/assets?' + query, {
    method:'POST',credentials:'same-origin',headers:mediaHeaders(tenantId,contentType,'avatar-studio:' + crypto.randomUUID()),body:file
  });
  let asset = {};
  try { asset = await upload.json(); } catch {}
  if (!upload.ok) throw new Error(asset.message || 'Media upload failed (' + upload.status + ')');
  if (!publish) return asset;
  const publication = await fetch('/v1/media/assets/' + encodeURIComponent(asset.id) + '/publication', {
    method:'POST',credentials:'same-origin',headers:{'x-spmt-tenant':tenantId,'x-spmt-app':'streamweaver'}
  });
  let published = {};
  try { published = await publication.json(); } catch {}
  if (!publication.ok || !published.publicUrl) throw new Error(published.message || 'Could not publish the avatar asset.');
  return {...asset,...published};
}
async function exportCombinedGlb() {
  if (!avatar || !currentModelFile) throw new Error('Load a GLB avatar first.');
  const tweakState = tweakControls.toJSON();
  const hasModelFitTweaks = tweakState.headScale !== 1 || tweakState.headOffsetY !== 0 || tweakState.headOffsetZ !== 0;
  if (!clips.length && !hasModelFitTweaks) { persistStatus('No imported clips or model-fit changes to export. The existing GLB will be uploaded unchanged.'); return currentModelFile; }
  const {GLTFExporter} = await import('three/addons/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  const binary = await new Promise((resolve, reject) => exporter.parse(
    avatar, resolve, reject,
    {binary:true, onlyVisible:true, animations:clips.map(entry => entry.clip)}
  ));
  if (!(binary instanceof ArrayBuffer)) throw new Error('GLB exporter did not return binary data.');
  currentModelFile = new File([binary], (currentModelFile.name || 'avatar.glb').replace(/\.glb$/i,'') + '-studio.glb', {type:'model/gltf-binary'});
  persistStatus('Exported the current model with ' + clips.length + ' animation clip(s) and the current model-fit transforms.');
  return currentModelFile;
}
exportGlbButton.addEventListener('click', async () => {
  exportGlbButton.disabled = true;
  try { await exportCombinedGlb(); }
  catch(error) { persistStatus(error?.message || 'Could not export the GLB.', true); }
  finally { exportGlbButton.disabled = false; }
});
saveAudio2FaceButton.addEventListener('click', async () => {
  saveAudio2FaceButton.disabled = true;
  try {
    const current = await tenantControl();
    await controlApi('/appearance',{audio2FaceUrl:a2fUrl.value.trim(),morphIntensity:tweakControls.getState().morphIntensity});
    persistStatus('Audio2Face bridge setting saved for tenant ' + current.tenantId + '. The existing browser source will reconnect to it.');
  } catch(error) { persistStatus(error?.message || 'Could not save Audio2Face settings.', true); }
  finally { saveAudio2FaceButton.disabled = false; }
});
savePngButton.addEventListener('click', async () => {
  savePngButton.disabled = true;
  try {
    if (sourceMode.value !== '2d') throw new Error('Choose 2D PNG-Tuber mode first.');
    if (!pngIdleFile) throw new Error('Choose an idle PNG/WebP image first.');
    const current = await tenantControl(), tenantId = current.tenantId;
    persistStatus('Uploading the idle image privately…');
    const idleType = pngIdleFile.type === 'image/webp' ? 'image/webp' : 'image/png';
    const idle = await uploadStudioAsset(pngIdleFile,'avatar',idleType,tenantId,true);
    let talkingUrl = '';
    if (pngSpeakingFile) {
      persistStatus('Uploading the speaking image…');
      const talkType = pngSpeakingFile.type === 'image/webp' ? 'image/webp' : 'image/png';
      const talking = await uploadStudioAsset(pngSpeakingFile,'avatar',talkType,tenantId,true);
      talkingUrl = talking.publicUrl;
    }
    await controlApi('/appearance',{avatarUrl:idle.publicUrl,talkingUrl,modelUrl:'',modelAssetId:'',audio2FaceUrl:a2fUrl.value.trim(),morphIntensity:tweakControls.getState().morphIntensity});
    persistStatus('2D PNG-Tuber saved and selected as the active StreamWeaver browser-source avatar.');
  } catch(error) { persistStatus(error?.message || 'Could not save the 2D avatar.', true); }
  finally { savePngButton.disabled = false; }
});
async function pollRiggingJob(jobId) {
  try {
    for (let attempt=0; attempt<900; attempt++) {
      const data = await controlApi('/voice/jobs/' + encodeURIComponent(jobId));
      const job = data.job || data;
      if (job.progress?.message) persistStatus(job.progress.message + ' · ' + (job.progress.percent || 0) + '%');
      if (job.state === 'succeeded') {
        persistStatus('Rigging completed. The new 3D model is published and active in the StreamWeaver browser source.');
        return;
      }
      if (['failed','dead-letter','cancelled'].includes(job.state)) throw new Error(job.error?.message || 'The direct GLB rigging job failed.');
      await new Promise(resolve => setTimeout(resolve,2000));
    }
    persistStatus('Rigging is still running. You can leave this page and return later.');
  } catch(error) { persistStatus(error?.message || 'Could not check rigging status.', true); }
}
rig3dButton.addEventListener('click', async () => {
  rig3dButton.disabled = true;
  try {
    if (sourceMode.value !== '3d') throw new Error('Choose 3D rigged avatar mode first.');
    if (currentModelPurpose === 'finished') throw new Error('The commissioned finished model is view-only and cannot be changed or sent through rigging.');
    if (!currentModelFile) throw new Error('Upload a .glb model in the Model library first.');
    if (!/\.glb$/i.test(currentModelFile.name)) throw new Error('Save the model as GLB first; a standalone .gltf may reference files that were not uploaded.');
    if (currentModelFile.size > 50 * 1024 * 1024) throw new Error('The GLB must be no larger than 50 MiB for shared-media upload.');
    const tweakState = tweakControls.toJSON();
    if (clips.some(entry => entry.source !== 'embedded') || tweakState.headScale !== 1 || tweakState.headOffsetY !== 0 || tweakState.headOffsetZ !== 0) await exportCombinedGlb();
    const current = await tenantControl();
    await controlApi('/appearance',{audio2FaceUrl:a2fUrl.value.trim(),morphIntensity:tweakState.morphIntensity});
    persistStatus('Uploading the existing GLB privately…');
    const asset = await uploadStudioAsset(currentModelFile,'avatar','model/gltf-binary',current.tenantId,false);
    persistStatus('Starting direct GLB rigging. No photo turnaround or second head reconstruction is used.');
    const result = await controlApi('/avatar-build',{modelAssetId:asset.id,requestId:'avatar-studio-rig:' + crypto.randomUUID()});
    persistStatus('Rigging job queued. The browser source will switch to the published model when it completes.');
    void pollRiggingJob(result.jobId);
  } catch(error) { persistStatus(error?.message || 'Could not start direct rigging.', true); }
  finally { rig3dButton.disabled = false; }
});

`;
  return updated.slice(0, adjustedScriptAt) + bridgeScript + updated.slice(adjustedScriptAt);
}
