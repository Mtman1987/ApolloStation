function renderBaseAvatarStudioPage(nonce: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>Overlay Bay · Avatar Studio</title><style>
:root{color-scheme:dark;font:14px system-ui;color:#edf4ff;background:#070b14}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}#room{position:fixed;inset:0;background:radial-gradient(ellipse at 50% 65%,#202943 0,#0b1221 42%,#05070d 100%)}canvas{display:block;width:100%;height:100%}#hint{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:8px 12px;border:1px solid #ffffff20;border-radius:30px;background:#080d18a8;color:#b9c9e8;pointer-events:none}#editor{position:absolute;inset:12px;display:grid;grid-template-columns:minmax(190px,260px) 1fr minmax(220px,300px);gap:10px;pointer-events:none}#editor[hidden]{display:none}.panel{pointer-events:auto;overflow:auto;max-height:100%;border:1px solid #7e9bc84a;border-radius:14px;background:#08101fe8;backdrop-filter:blur(18px);padding:14px;box-shadow:0 12px 45px #0008}.panel h2{font-size:16px;margin:0 0 12px}.panel p{color:#aabbd7;font-size:12px;line-height:1.45}label{display:grid;gap:5px;margin:10px 0;color:#c7d5eb;font-size:12px}input,select,button{font:inherit;color:#eef5ff;background:#131f33;border:1px solid #4b6386;border-radius:8px;padding:9px;max-width:100%;width:100%}input[type=file]{font-size:11px}button{cursor:pointer}button.primary{background:#573dd0;border-color:#a69aff}button:disabled{opacity:.5}#toolbar{display:flex;gap:7px;flex-wrap:wrap}#toolbar button{width:auto}#status{font-size:11px;color:#9ec7ff;overflow-wrap:anywhere}.cliprow{display:flex;gap:6px;align-items:center}.cliprow select{flex:1;min-width:0}.cliprow button{width:auto}.rule{border-top:1px solid #ffffff18;margin:14px 0;padding-top:10px}.ghost{position:absolute;top:14px;right:14px;pointer-events:auto;width:auto;z-index:3;background:#0a1220b8}body.clean #hint{opacity:.4}@media(max-width:800px){#editor{grid-template-columns:1fr 1fr;inset:8px;overflow:auto}#editor .panel:last-child{grid-column:1/-1;max-height:35vh}#editor .panel{max-height:46vh;padding:10px}#editor .panel:nth-child(2){display:none}#hint{font-size:11px;white-space:nowrap;bottom:8px}}
</style></head><body><main id="room" aria-label="3D avatar preview room"></main><button id="toggle" class="ghost" type="button">Open Avatar Studio</button><div id="hint">Clean preview · tap the room to open controls</div><section id="editor" hidden aria-label="Avatar Studio controls">
<aside class="panel"><h2>Model library</h2><label>Upload rigged model (GLB)<input id="modelFile" type="file" accept=".glb,model/gltf-binary"></label><label>Model<select id="modelSelect"><option value="current">Current model / uploaded GLB</option><option value="male-body">Generic male body · editable</option><option value="female-body">Generic female body · editable</option><option value="commissioned">Commissioned finished model · view only</option></select></label><button id="loadLibraryModel" type="button">Load selected library model</button><p>Generic bodies are separate starting models. The commissioned finished model is opened in a view-only path and is not rebuilt, rigged, or altered.</p><div id="modelInfo" class="rule"><p>Upload a GLB to preview it in this room. Select a GLB, preview and edit its motions, then save it to StreamWeaver for direct rigging and activation.</p></div><div class="rule" id="wardrobeLibrary"><h2>Hair library</h2><p>Real CC0 hair meshes. Hair is attached to the selected generic body’s head area; choose a style and apply it.</p><label>Hairstyle<select id="hairStyle"><option value="">No hair change</option><option value="short02">Short textured</option><option value="short04">Short swept</option><option value="bob01">Bob 1</option><option value="bob02">Bob 2</option><option value="long01">Long straight</option><option value="ponytail01">Ponytail</option><option value="braid01">Braid</option><option value="afro01">Afro</option></select></label><button id="applyHair" type="button">Apply hairstyle</button><div class="rule"><h2>Clothing library</h2><p>Real fitted garment meshes with their original materials. Apply pieces separately so you can mix tops, bottoms, outerwear and shoes.</p><label>Top<select id="wardrobeTop"><option value="">Keep current</option><option value="tshirt">T-shirt</option><option value="shirt">Long-sleeve shirt</option><option value="hoodie">Hoodie</option></select></label><label>Bottom<select id="wardrobeBottom"><option value="">Keep current</option><option value="jeans">Jeans</option><option value="shorts">Shorts</option><option value="skirt">Skirt</option></select></label><label>Outerwear / outfit<select id="wardrobeOuterwear"><option value="">Keep current</option><option value="jacket">Jacket</option><option value="trenchcoat">Long trench coat</option><option value="dress">Dress</option></select></label><label>Shoes<select id="wardrobeShoes"><option value="">Keep current</option><option value="shoes">Shoes</option><option value="boots">Boots</option></select></label><button id="applyClothing" class="primary" type="button">Apply selected clothing</button><button id="clearWardrobe" type="button">Clear hair &amp; clothing</button><div id="wardrobeStatus" role="status">Choose a generic male or female body to try on the library assets.</div></div></div><div id="toolbar"><button id="reset" type="button">Reset camera</button><button id="pause" type="button">Pause</button></div></aside>
<aside class="panel"><h2>3D preview</h2><p>Drag to orbit · scroll/pinch to zoom. Animation playback continues when controls are hidden.</p><div id="status" role="status">Preparing 3D renderer…</div><div class="cliprow"><button id="exportCombinedGlb" type="button">Export model + imported clips</button><button id="rigActivate3d" class="primary" type="button">Rig &amp; activate 3D avatar</button></div><p>Imported animation clips are attached to the exported GLB before upload, rather than remaining only in this browser preview.</p><p>Embedded clips, imported GLBs, and the shared retargetable motion library use one selector. Cross-rig imports are retargeted when the rig passes the library coverage check.</p><div class="rule"><h2>Model fit tweaks</h2><label>Model/head scale<input id="avatarTweakScale" type="range" min="0.6" max="1.4" step="0.01" value="1"></label><label>Vertical offset<input id="avatarTweakY" type="range" min="-0.5" max="0.5" step="0.01" value="0"></label><label>Depth offset<input id="avatarTweakZ" type="range" min="-0.5" max="0.5" step="0.01" value="0"></label><label>Facial movement intensity<input id="avatarTweakMorph" type="range" min="0" max="2" step="0.05" value="1"></label><button id="resetAvatarTweaks" type="button">Reset fit tweaks</button><p>These controls are based on the ZIP’s TweakControls module. Transform changes are included when you export or rig the model.</p></div><div class="rule"><h2>Generate a 3D face</h2><p>Use a front-facing photo or camera capture. This reuses AvatarAce's photo-to-face mesh builder with 52 ARKit morph targets for the Audio2Face bridge.</p><label>Take a face photo<input id="facePhotoCamera" type="file" accept="image/*" capture="user"></label><label>Choose a photo<input id="facePhotoLibrary" type="file" accept="image/*"></label><label>Face version<select id="faceChoice"><option value="standard">Standard · closer to photo</option><option value="detail">Higher detail · smoother</option></select></label><label>Expression preset<select id="facePreset"><option value="captured">Photo expression</option><option value="smile">Warm smile</option><option value="blink">Blink</option><option value="wow">Surprised / wow</option><option value="laugh">Laughing</option><option value="cheer">Excited / cheering</option><option value="love">Heart eyes / delighted</option><option value="sad">Sad / disappointed</option><option value="angry">Angry / frustrated</option><option value="thinking">Thinking / skeptical</option></select></label><label>Expression strength<input id="faceExpression" type="range" min="0" max="1.4" step="0.01" value="1"></label><label>Head size<input id="faceHeadScale" type="range" min="0.8" max="1.35" step="0.01" value="1.05"></label><label>Head height<input id="faceHeadY" type="range" min="-0.06" max="0.08" step="0.005" value="0.01"></label><label>Head depth<input id="faceHeadZ" type="range" min="-0.04" max="0.1" step="0.005" value="0.02"></label><div class="cliprow"><button id="generate2dPng" type="button">Use photo as 2D PNG-Tuber</button></div><div id="faceGenerationStatus" role="status">Choose a photo to generate a 3D face for the selected generic body.</div></div><div class="rule"><h2>Free CC0 humanoid animation library</h2><button id="loadMotionLibrary" type="button">Load free CC0 motion pack</button><p>Loads Quaternius Universal Animation Library and retargets its compatible clips to the selected body rig. Use the Animation selector to preview each motion.</p><h2>Uploaded motion references</h2><div id="referenceMotions"></div></div></aside>
<aside class="panel"><h2>Unified animation library</h2><label>Import animation GLB/GLTF<input id="animationFile" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></label><label>Cohost action<select id="cohostAction"><option value="idle-standing">Standing idle</option><option value="idle-sitting">Seated idle</option><option value="wave">Wave to chat</option><option value="cheer">Cheer / celebrate</option><option value="laugh">Laugh / react</option><option value="think">Thinking / listening</option><option value="talk">Talking gesture</option><option value="stop">Stop body motion</option></select></label><button id="playCohostAction" type="button">Play cohost action</button><label>Animation category<select id="clipCategory"><option value="all">All animations</option><option value="idle">Idle / seated / standing</option><option value="social">Wave / cheer / reactions</option><option value="talk">Talking / listening</option><option value="other">Other</option></select></label><label>Animation<select id="clipSelect"><option value="">No clips loaded</option></select></label><div class="cliprow"><button id="play" class="primary" type="button">Play selected</button><button id="stop" type="button">Stop</button></div><div class="rule"><h2>Trigger assignments</h2><label>Trigger source<select id="triggerSource"><option>AI command</option><option>AI speaking</option><option>Twitch follow</option><option>Subscription</option><option>Raid</option><option>Channel Point redemption</option><option>Chat command</option><option>Manual</option></select></label><label>Trigger name<input id="triggerName" value="bow_gesture" placeholder="e.g. bow_gesture, !dance"></label><label>Animation for trigger<select id="triggerClip"></select></label><label>Playback behavior<select id="triggerBehavior"><option>Play once</option><option>Loop until stopped</option><option>Play while speaking</option></select></label><button id="addTrigger" type="button">Add trigger mapping</button><div id="triggerList"></div><p>Mappings are a local test draft in this first pass. Production event ingestion and durable storage are a separate integration step.</p></div></aside></section>
<script type="importmap" nonce="${nonce}">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script><script src="https://cdn.jsdelivr.net/gh/Mtman1987/3davatar@main/avatarace-patch/face-builder-browser.js" nonce="${nonce}"></script><script type="module" nonce="${nonce}">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationManager, retargetClipToObject } from 'https://cdn.jsdelivr.net/npm/@three-ws/retarget@0.1.1/+esm';
const room=document.querySelector('#room'),editor=document.querySelector('#editor'),toggle=document.querySelector('#toggle'),hint=document.querySelector('#hint'),status=document.querySelector('#status');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080d18);scene.fog=new THREE.Fog(0x080d18,9,28);
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,100);camera.position.set(0,1.5,5.4);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;room.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc4d8ff,0x242033,2));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,6,4);scene.add(key);const rim=new THREE.PointLight(0x725cff,24,12);rim.position.set(-3,2,0);scene.add(rim);
const floor=new THREE.Mesh(new THREE.CircleGeometry(8,64),new THREE.MeshStandardMaterial({color:0x111b2c,metalness:.3,roughness:.7}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);const grid=new THREE.GridHelper(16,32,0x32466a,0x1a2941);grid.position.y=0;scene.add(grid);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.enableDamping=true;const loader=new GLTFLoader();let avatar=null,mixer=null,activeAction=null,paused=false,clips=[],modelUrl=null,animationUrls=[],triggers=[],motionManager=null,currentModelFile=null,currentModelPurpose='upload',headAnchor=null,faceMesh=null,generatedFaces=null,faceSourceCanvas=null,faceLandmarkerPromise=null,usingGpu=true,hasGeneratedFace=false; const referenceMotions=['Formal_Bow.gif','FunnyDancing_01.gif','Chair_Sit_Idle_M.gif','Big_Wave_Hello.gif','Confused_Scratch.gif','Discuss_While_Moving.gif','Dodge_and_Counter.gif','Call_Gesture.gif','Dozing_Elderly.gif'];
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
function motionCategory(entry){const n=entry.name.toLowerCase();if(/sit|chair|seated/.test(n))return'idle';if(/idle|stand|rest|breath|listen|think/.test(n))return n.includes('think')||n.includes('listen')?'talk':'idle';if(/wave|cheer|celebr|clap|laugh|joy|happy|victory|react|greet|dance/.test(n))return'social';if(/talk|speak|convers|explain|gesture|point/.test(n))return'talk';return'other'}
function updateClips(){const selected=clipSelect.value,category=document.querySelector('#clipCategory')?.value||'all';clipSelect.replaceChildren();triggerClip.replaceChildren();clips.forEach((entry,i)=>{const o=new Option(entry.name+' · '+entry.source,String(i));if(category==='all'||motionCategory(entry)===category)clipSelect.add(o);triggerClip.add(new Option(entry.name,String(i)))});if(!clipSelect.options.length)clipSelect.add(new Option(clips.length?'No clips in this category':'No clips loaded',''));if(!clips.length)triggerClip.add(new Option('No clips loaded',''));if([...clipSelect.options].some(o=>o.value===selected))clipSelect.value=selected;}
function clearAvatar(){if(avatar){scene.remove(avatar);avatar.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose())}})}avatar=null;mixer=null;activeAction=null;clips=[];headAnchor=null;faceMesh=null;hasGeneratedFace=false;updateClips()}
function loadModel(file){if(!/\\.glb$/i.test(file.name)){status.textContent='Please upload a single-file GLB model. A .gltf file may depend on external binary or texture files.';return}currentModelPurpose='upload';currentModelFile=file;for(const id of ['avatarTweakScale','avatarTweakY','avatarTweakZ'])document.querySelector('#'+id).disabled=false;document.querySelector('#resetAvatarTweaks').disabled=false;document.querySelector('#rigActivate3d').disabled=false;const url=URL.createObjectURL(file);if(modelUrl)URL.revokeObjectURL(modelUrl);modelUrl=url;loader.load(url,g=>{clearAvatar();avatar=g.scene;scene.add(avatar);const box=new THREE.Box3().setFromObject(avatar),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());avatar.position.x-=center.x;avatar.position.z-=center.z;avatar.position.y-=box.min.y;const scale=2.1/Math.max(size.y,.01);baseModelScale=scale;baseModelPosition.copy(avatar.position);avatar.scale.setScalar(scale);applyAvatarTweaks();mixer=new THREE.AnimationMixer(avatar);clips=g.animations.map(c=>({name:c.name||'Animation '+(clips.length+1),clip:c,source:'embedded'}));motionManager=new AnimationManager();try{motionManager.attach(avatar)}catch{}updateClips();modelInfo.innerHTML='<p><b>'+escapeHtml(file.name)+'</b><br>'+g.animations.length+' embedded animation(s) · '+Math.round(file.size/1024)+' KB</p>';status.textContent='Model loaded. '+g.animations.length+' embedded clip(s) found.';document.querySelector('#modelSelect').add(new Option(file.name,String(Date.now())));},undefined,e=>{status.textContent='Model load failed: '+(e?.message||'unknown error')})}
const libraryModels={
 'male-body':{label:'Generic male body',url:'https://cdn.jsdelivr.net/gh/Mtman1987/3davatar@main/male-base-mesh-base_male.glb',filename:'male-base-mesh-base_male.glb',purpose:'body'},
 'female-body':{label:'Generic female body',url:'https://cdn.jsdelivr.net/gh/Mtman1987/3davatar@main/female-base-mesh-base_female.glb',filename:'female-base-mesh-base_female.glb',purpose:'body'},
 'commissioned':{label:'Commissioned finished model',url:'https://cdn.jsdelivr.net/gh/Mtman1987/3davatar@main/Meshy_AI_Neon_Lock_In_Gamer_All_Animations%20(1).glb',filename:'commissioned-finished-model.glb',purpose:'finished'}
};
// CC0 asset GLBs are hosted in the upstream asset-only output directory; no GPL code is imported.
const wardrobeAssets={
 hair:{short02:'hair_short02.glb',short04:'hair_short04.glb',bob01:'hair_bob01.glb',bob02:'hair_bob02.glb',long01:'hair_long01.glb',ponytail01:'hair_ponytail01.glb',braid01:'hair_braid01.glb',afro01:'hair_afro01.glb'},
 top:{tshirt:'clothing_tshirt.glb',shirt:'clothing_shirt.glb',hoodie:'clothing_hoodie.glb'},
 bottom:{jeans:'clothing_jeans.glb',shorts:'clothing_shorts.glb',skirt:'clothing_skirt.glb'},
 outerwear:{jacket:'clothing_jacket.glb',trenchcoat:'clothing_trenchcoat.glb',dress:'clothing_dress.glb'},
 shoes:{shoes:'clothing_shoes.glb',boots:'clothing_boots.glb'}
};
const wardrobeAttached={};
const wardrobeBaseUrl='https://cdn.jsdelivr.net/gh/kblood/CharacterCreator@master/output/';
function disposeWardrobeObject(object){object.traverse(node=>{if(node.geometry)node.geometry.dispose();if(node.material){const materials=Array.isArray(node.material)?node.material:[node.material];materials.forEach(material=>material.dispose())}})}
function clearWardrobeItem(slot){const old=wardrobeAttached[slot];if(old&&avatar){avatar.remove(old);disposeWardrobeObject(old);delete wardrobeAttached[slot]}}
function setWardrobeStatus(message){const el=document.querySelector('#wardrobeStatus');if(el)el.textContent=message}
function applyWardrobeAsset(slot,id){
 if(!avatar){setWardrobeStatus('Load a generic male or female body first.');return}
 if(currentModelPurpose==='finished'){setWardrobeStatus('The commissioned finished model is view-only; hair and clothing are not attached to it.');return}
 const filename=wardrobeAssets[slot]?.[id];if(!filename){setWardrobeStatus('Choose an available asset first.');return}
 setWardrobeStatus('Loading '+filename+'…');
 loader.load(wardrobeBaseUrl+filename,g=>{
  if(!avatar||currentModelPurpose==='finished'){disposeWardrobeObject(g.scene);setWardrobeStatus('Wardrobe is available only on editable generic bodies.');return}
  const item=g.scene;item.name='wardrobe-'+slot+'-'+id;
  const bodyBox=new THREE.Box3().setFromObject(avatar);
  const bodySize=bodyBox.getSize(new THREE.Vector3());
  const bodyCenterWorld=bodyBox.getCenter(new THREE.Vector3());
  const centerLocal=avatar.worldToLocal(bodyCenterWorld.clone());
  const floorLocal=avatar.worldToLocal(new THREE.Vector3(bodyCenterWorld.x,bodyBox.min.y,bodyCenterWorld.z)).y;
  const topLocal=avatar.worldToLocal(new THREE.Vector3(bodyCenterWorld.x,bodyBox.max.y,bodyCenterWorld.z)).y;
  const assetBox=new THREE.Box3().setFromObject(item);
  const assetSize=assetBox.getSize(new THREE.Vector3());
  const assetCenter=assetBox.getCenter(new THREE.Vector3());
  const bodyHeight=Math.max(bodySize.y/Math.max(Math.abs(avatar.scale.y),.001),.01);
  if(slot==='hair'){
   const targetWidth=bodyHeight*.205;
   const scale=targetWidth/Math.max(assetSize.x,.001);
   item.scale.setScalar(scale);
   item.position.set(centerLocal.x-assetCenter.x*scale,topLocal-bodyHeight*.045-assetBox.max.y*scale,centerLocal.z-assetCenter.z*scale);
  }else{
   const scale=bodyHeight/Math.max(assetSize.y,.001);
   item.scale.setScalar(scale);
   item.position.set(centerLocal.x-assetCenter.x*scale,floorLocal-assetBox.min.y*scale,centerLocal.z-assetCenter.z*scale);
  }
  clearWardrobeItem(slot);avatar.add(item);wardrobeAttached[slot]=item;
  setWardrobeStatus('Applied '+filename+'. Fit is normalized to this body; please check the visual fit and any clipping in the preview.');
 },undefined,error=>setWardrobeStatus('Could not load '+filename+': '+(error?.message||'network or asset error')));
}
document.querySelector('#applyHair')?.addEventListener('click',()=>{const id=document.querySelector('#hairStyle').value;if(id)applyWardrobeAsset('hair',id);else setWardrobeStatus('Choose a hairstyle first.')});
document.querySelector('#applyClothing')?.addEventListener('click',()=>{
 const chosen=[['top','wardrobeTop'],['bottom','wardrobeBottom'],['outerwear','wardrobeOuterwear'],['shoes','wardrobeShoes']].filter(([,id])=>document.querySelector('#'+id).value);
 if(!chosen.length){setWardrobeStatus('Choose at least one clothing item.');return}
 chosen.forEach(([slot,id])=>applyWardrobeAsset(slot,document.querySelector('#'+id).value));
});
document.querySelector('#clearWardrobe')?.addEventListener('click',()=>{Object.keys(wardrobeAttached).forEach(clearWardrobeItem);setWardrobeStatus('Hair and clothing removed from the current preview.')});
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
   avatar=g.scene;
   const box=new THREE.Box3().setFromObject(avatar),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
   if(currentModelPurpose==='body'){
    headAnchor=new THREE.Group();headAnchor.name='HeadAnchor';headAnchor.position.set(center.x,box.min.y+size.y*.885,center.z+size.z*.12);avatar.add(headAnchor);
    const fitScale=1.8/Math.max(size.y,.01);avatar.scale.multiplyScalar(fitScale);avatar.position.set(-center.x*fitScale,-box.min.y*fitScale,-center.z*fitScale);
    baseModelScale=fitScale;baseModelPosition.copy(avatar.position);
   }else{baseModelScale=1;baseModelPosition.copy(avatar.position)}
   scene.add(avatar);
   if(currentModelPurpose==='body')attachGeneratedFace();
   const target=currentModelPurpose==='body'?new THREE.Vector3(0,.9,0):center;
   controls.target.copy(target);const distance=Math.max(size.x,size.y,size.z,1)*2.5;camera.position.set(target.x,target.y+size.y*.18,target.z+distance);camera.lookAt(target);controls.update();
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

function makeGeneratedFace(built){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(built.positions.slice(),3));
 geometry.setAttribute('uv',new THREE.BufferAttribute(built.uvs.slice(),2));
 geometry.setIndex(new THREE.BufferAttribute(built.indices,1));
 geometry.computeVertexNormals();
 geometry.morphAttributes.position=built.morphs.map(morph=>new THREE.BufferAttribute(morph.slice(),3));
 const texture=new THREE.CanvasTexture(built.texture);texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=true;texture.anisotropy=4;
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:texture,roughness:.55,metalness:.02,side:THREE.DoubleSide}));
 mesh.name='ARKitFace';
 mesh.morphTargetDictionary=Object.fromEntries(window.AvatarAceFaceBuilder.ARKIT_BLENDSHAPE_NAMES.map((name,index)=>[name,index]));
 mesh.morphTargetInfluences=built.influences.slice();mesh.userData.base=built.influences.slice();
 return mesh;
}
function attachGeneratedFace(){
 if(!headAnchor||!generatedFaces||currentModelPurpose!=='body')return;
 if(faceMesh){headAnchor.remove(faceMesh);faceMesh.geometry.dispose();const mats=Array.isArray(faceMesh.material)?faceMesh.material:[faceMesh.material];mats.forEach(m=>{if(m.map)m.map.dispose();m.dispose()});faceMesh=null}
 const choice=document.querySelector('#faceChoice').value||'standard';
 faceMesh=makeGeneratedFace(generatedFaces[choice]||generatedFaces.standard);
 headAnchor.add(faceMesh);hasGeneratedFace=true;syncGeneratedFaceFit();applyGeneratedFaceExpression();
 document.querySelector('#faceGenerationStatus').textContent='3D face generated and attached to the selected generic body. Its 52 ARKit morph targets are available to Audio2Face.';
}
function syncGeneratedFaceFit(){
 if(!faceMesh)return;
 faceMesh.scale.setScalar(Number(document.querySelector('#faceHeadScale').value));
 faceMesh.position.y=Number(document.querySelector('#faceHeadY').value);
 faceMesh.position.z=Number(document.querySelector('#faceHeadZ').value);
}
const faceExpressionPresets={smile:{mouthSmileLeft:.85,mouthSmileRight:.85,eyeSquintLeft:.35,eyeSquintRight:.35,cheekSquintLeft:.3,cheekSquintRight:.3},blink:{eyeBlinkLeft:1,eyeBlinkRight:1},wow:{jawOpen:.65,eyeWideLeft:.75,eyeWideRight:.75,browInnerUp:.55,browOuterUpLeft:.35,browOuterUpRight:.35},laugh:{jawOpen:.55,mouthSmileLeft:.95,mouthSmileRight:.95,eyeSquintLeft:.65,eyeSquintRight:.65,cheekSquintLeft:.6,cheekSquintRight:.6,noseSneerLeft:.15,noseSneerRight:.15},cheer:{mouthSmileLeft:1,mouthSmileRight:1,eyeWideLeft:.35,eyeWideRight:.35,browInnerUp:.45,cheekSquintLeft:.45,cheekSquintRight:.45},love:{mouthSmileLeft:.8,mouthSmileRight:.8,eyeBlinkLeft:.18,eyeBlinkRight:.18,cheekSquintLeft:.4,cheekSquintRight:.4},sad:{mouthFrownLeft:.75,mouthFrownRight:.75,browInnerUp:.65,eyeSquintLeft:.2,eyeSquintRight:.2},angry:{browDownLeft:.8,browDownRight:.8,noseSneerLeft:.35,noseSneerRight:.35,mouthPressLeft:.3,mouthPressRight:.3},thinking:{browDownLeft:.2,browInnerUp:.35,eyeLookUpLeft:.35,eyeLookUpRight:.35,mouthPucker:.15}};
function applyGeneratedFaceExpression(){
 if(!faceMesh)return;
 const names=window.AvatarAceFaceBuilder.ARKIT_BLENDSHAPE_NAMES,base=faceMesh.userData.base||[],preset=document.querySelector('#facePreset').value,intensity=Number(document.querySelector('#faceExpression').value);
 const out=new Array(names.length).fill(0);
 if(preset==='captured'){for(let i=0;i<names.length;i++)out[i]=(base[i]||0)*intensity}
 else for(const [name,value] of Object.entries(faceExpressionPresets[preset]||{})){const index=names.indexOf(name);if(index>=0)out[index]=value*intensity}
 faceMesh.morphTargetInfluences=out;
}
async function createFaceLandmarker(gpu){
 const {FaceLandmarker,FilesetResolver}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm');
 const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
 return FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:gpu?'GPU':'CPU'},runningMode:'IMAGE',numFaces:1,outputFaceBlendshapes:true});
}
async function getFaceLandmarker(){
 if(!faceLandmarkerPromise)faceLandmarkerPromise=createFaceLandmarker(true).catch(()=>{usingGpu=false;return createFaceLandmarker(false)});
 return faceLandmarkerPromise;
}
async function generateFaceFromPhoto(file){
 const faceStatus=document.querySelector('#faceGenerationStatus');
 faceStatus.textContent='Preparing photo and finding the face…';
 try{
  if(!window.AvatarAceFaceBuilder||typeof window.AvatarAceFaceBuilder.buildFace!=='function')throw new Error('The face-builder module has not loaded yet. Check the CDN connection and retry.');
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not prepare the photo canvas.');
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();faceSourceCanvas=canvas;
  let landmarker=await getFaceLandmarker(),result;
  try{result=landmarker.detect(canvas)}catch(error){if(!usingGpu)throw error;usingGpu=false;faceLandmarkerPromise=createFaceLandmarker(false);landmarker=await faceLandmarkerPromise;result=landmarker.detect(canvas)}
  const raw=result.faceLandmarks?.[0];if(!raw||raw.length<100)throw new Error('No face found. Try a clear, front-facing photo with the whole face visible.');
  const landmarks=raw.map(lm=>({x:lm.x,y:lm.y,z:lm.z??0}));
  const categories=result.faceBlendshapes?.[0]?.categories??[];
  faceStatus.textContent='Building standard and high-detail 3D faces…';
  generatedFaces={standard:window.AvatarAceFaceBuilder.buildFace(landmarks,categories,canvas,'standard'),detail:window.AvatarAceFaceBuilder.buildFace(landmarks,categories,canvas,'detail')};
  document.querySelector('#faceChoice').value='standard';
  if(headAnchor&&currentModelPurpose==='body')attachGeneratedFace();
  else faceStatus.textContent='Face generated. Load the generic male or female body to attach it; the commissioned model remains separate and untouched.';
 }catch(error){faceStatus.textContent=error?.message||'Face generation failed. Try another photo.'}
}
function handleFacePhoto(event){
 const file=event.target.files?.[0];event.target.value='';if(file)void generateFaceFromPhoto(file);
}
document.querySelector('#facePhotoCamera').addEventListener('change',handleFacePhoto);
document.querySelector('#facePhotoLibrary').addEventListener('change',handleFacePhoto);
document.querySelector('#faceChoice').addEventListener('change',attachGeneratedFace);
document.querySelector('#facePreset').addEventListener('change',applyGeneratedFaceExpression);
document.querySelector('#faceExpression').addEventListener('input',applyGeneratedFaceExpression);
for(const id of ['faceHeadScale','faceHeadY','faceHeadZ'])document.querySelector('#'+id).addEventListener('input',syncGeneratedFaceFit);
function loadAnimation(file){const url=URL.createObjectURL(file);animationUrls.push(url);loader.load(url,g=>{if(!avatar){status.textContent='Load a target model first, then import animation clips.';return}const added=[];const rejected=[];for(const sourceClip of g.animations){try{const result=retargetClipToObject(sourceClip,avatar);if(result.clip)added.push({name:sourceClip.name||file.name,clip:result.clip,source:file.name,coverage:result.coverage});else rejected.push((sourceClip.name||file.name)+' ('+Math.round((result.coverage||0)*100)+'% bone coverage)')}catch(error){rejected.push((sourceClip.name||file.name)+' ('+(error?.message||'retarget failed')+')')}}clips.push(...added);updateClips();status.textContent='Retargeted '+added.length+' clip(s) from '+file.name+'.'+(rejected.length?' Skipped '+rejected.length+' incompatible clip(s): '+rejected.slice(0,3).join(', '):'')},undefined,e=>status.textContent='Animation import failed: '+(e?.message||'unknown error'))}
document.querySelector('#clipCategory').addEventListener('change',updateClips);
function playCohostAction(){const action=document.querySelector('#cohostAction').value;if(action==='stop'){if(activeAction){activeAction.stop();activeAction=null}status.textContent='Body motion stopped; facial animation remains available.';return}if(!avatar||!mixer){status.textContent='Load a rigged generic body before previewing cohost actions.';return}const patterns={'idle-standing':/stand.*idle|idle.*stand|standing|idle$/i,'idle-sitting':/sit.*idle|idle.*sit|seated|sitting/i,wave:/wave|greet|hello/i,cheer:/cheer|celebr|victory|clap|happy|joy/i,laugh:/laugh|giggle|chuckle/i,think:/think|listen|ponder|look.?around/i,talk:/talk|speak|convers|explain|gesture/i};const entry=clips.find(x=>patterns[action]?.test(x.name));if(!entry){status.textContent='No compatible '+action.replace('idle-','')+' clip is loaded yet. Load the CC0 pack or import a matching rigged animation GLB; available motions remain in the Animation selector.';return}const index=clips.indexOf(entry);clipSelect.value=String(index);playIndex(index,action.startsWith('idle-')?'repeat':'once');if(action==='idle-sitting'&&!/sit|seated/i.test(entry.name))status.textContent='Could not confirm this clip is seated; check the preview before using it.'}
document.querySelector('#playCohostAction').addEventListener('click',playCohostAction);
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
document.querySelector('#loadMotionLibrary').addEventListener('click',()=>{
 if(!avatar||!mixer){status.textContent='Load a generic male/female body or another rigged GLB first.';return}
 const button=document.querySelector('#loadMotionLibrary');button.disabled=true;status.textContent='Downloading the free CC0 humanoid animation pack…';
 const url='https://cdn.jsdelivr.net/gh/NafisRayan/Animate-Rigged-Humanoid-No-Blender@main/Universal%20Animation%20Library%5BStandard%5D/Universal%20Animation%20Library%5BStandard%5D/Unreal-Godot/UAL1_Standard.glb';
 loader.load(url,g=>{
  const added=[],rejected=[];const existing=new Set(clips.map(entry=>entry.name));
  for(const sourceClip of g.animations){
   const name=sourceClip.name||'Quaternius motion '+(added.length+1);
   if(existing.has(name)){continue}
   try{
    const result=retargetClipToObject(sourceClip,avatar);
    if(result.clip){added.push({name,clip:result.clip,source:'Quaternius Universal Animation Library · CC0',loop:/idle|walk|run|locomotion|crawl|swim/i.test(name),coverage:result.coverage});}
    else rejected.push(name+' ('+Math.round((result.coverage||0)*100)+'% coverage)');
   }catch(error){rejected.push(name+' ('+(error?.message||'retarget failed')+')')}
  }
  clips.push(...added);updateClips();button.disabled=false;
  status.textContent='CC0 library: added '+added.length+' compatible clips'+(rejected.length?'; skipped '+rejected.length+' clips for rig coverage.':' with adequate rig coverage.');
 },undefined,error=>{button.disabled=false;status.textContent='Could not load the CC0 animation pack: '+(error?.message||'network/asset error')});
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
  <p id="a2fTelemetry" role="status">Live Audio2Face frames received: 0. Connect the bridge and run speech through the bridge to verify real TTS-to-face output.</p>
  <label>Browser TTS visual smoke-test sentence<textarea id="a2fTestText" rows="2">Hello! This is a StreamWeaver avatar talking test.</textarea></label><div class="cliprow"><button id="a2fBridgeTtsTest" type="button">Send TTS test to Audio2Face bridge</button><button id="a2fBrowserTtsTest" type="button">Browser TTS visual smoke test</button></div><p>The bridge TTS test sends <code>{"type":"tts_test","text":"..."}</code> to the configured bridge. The bridge must synthesize/obtain the speech audio, feed it to NVIDIA Audio2Face, and stream returned blendshape frames back. Browser TTS visual smoke test only checks local audio and jaw movement; it is not Audio2Face inference.</p>
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
let a2fFrameCount=0,a2fLastFrameAt=0,a2fLocalTtsTimer=null;
const a2fTelemetry=document.querySelector('#a2fTelemetry');
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
document.querySelector('#generate2dPng').addEventListener('click',()=>{
 if(!faceSourceCanvas){document.querySelector('#faceGenerationStatus').textContent='Choose or capture a face photo first.';return}
 faceSourceCanvas.toBlob(blob=>{
  if(!blob){document.querySelector('#faceGenerationStatus').textContent='Could not create the 2D PNG image.';return}
  const file=new File([blob],'generated-face.png',{type:'image/png'});
  sourceMode.value='2d';loadPngSource(file,false);setAvatarSourceMode();
  document.querySelector('#faceGenerationStatus').textContent='2D photo avatar created. You can add a speaking image and save it using the existing 2D PNG-Tuber controls.';
 },'image/png');
});
const jawBaseRotations = new WeakMap();
function applyA2FMessage(payload, fromBridge = true) {
  if (!payload || typeof payload !== 'object') return;
  const blendshapes = payload.blendshapes && typeof payload.blendshapes === 'object' ? payload.blendshapes : payload;
  if (fromBridge) { a2fFrameCount++; a2fLastFrameAt=Date.now(); const shapeCount=Object.keys(blendshapes).filter(key=>Number.isFinite(Number(blendshapes[key]))).length; a2fTelemetry.textContent='Live Audio2Face frames received: '+a2fFrameCount+' · latest frame has '+shapeCount+' numeric values · last frame '+new Date(a2fLastFrameAt).toLocaleTimeString()+'.'; }
  const raw = Number(blendshapes.jawOpen ?? blendshapes.mouthOpen ?? blendshapes.JawOpen ?? 0);
  const mouth = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
  const adjustedMouth = Math.max(0, Math.min(1, mouth * tweakControls.getState().morphIntensity * Number(document.querySelector('#faceExpression').value || 1)));
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
        if (idx !== undefined && Number.isFinite(Number(value))) node.morphTargetInfluences[idx] = Math.max(0, Math.min(1, Number(value) * tweakControls.getState().morphIntensity * Number(document.querySelector('#faceExpression').value || 1)));
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
    a2fSocket.addEventListener('open', () => { a2fStatus.textContent = 'Connected to bridge: ' + endpoint + '. Waiting for real Audio2Face blendshape frames.'; a2fTelemetry.textContent='Connected; live frames received so far: '+a2fFrameCount+'. Start TTS playback through the configured A2F bridge to confirm end-to-end output.'; });
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
document.querySelector('#a2fBridgeTtsTest').addEventListener('click',()=>{
 const text=document.querySelector('#a2fTestText').value.trim();
 if(!text){a2fStatus.textContent='Enter a short sentence to send to the TTS → Audio2Face bridge.';return}
 if(!a2fSocket||a2fSocket.readyState!==WebSocket.OPEN){a2fStatus.textContent='Connect the Audio2Face bridge first.';return}
 try{
  a2fSocket.send(JSON.stringify({type:'tts_test',text,requestId:'avatar-studio-tts-test-'+Date.now()}));
  a2fStatus.textContent='TTS test request sent to the bridge. Waiting for Audio2Face blendshape frames; the bridge must support the tts_test message.';
  a2fTelemetry.textContent='Live Audio2Face frames received: '+a2fFrameCount+'. Waiting for the TTS test response.';
 }catch(error){a2fStatus.textContent='Could not send TTS test request: '+(error?.message||'bridge send failed')}
});
document.querySelector('#a2fBrowserTtsTest').addEventListener('click',()=>{
 if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){a2fStatus.textContent='This browser does not provide speech synthesis. Use a TTS audio file through your configured Audio2Face bridge.';return}
 const text=document.querySelector('#a2fTestText').value.trim();if(!text){a2fStatus.textContent='Enter a short sentence for the browser TTS test.';return}
 speechSynthesis.cancel();if(a2fLocalTtsTimer)clearInterval(a2fLocalTtsTimer);
 const utterance=new SpeechSynthesisUtterance(text);utterance.rate=0.95;
 utterance.onstart=()=>{a2fStatus.textContent='Browser TTS visual smoke test playing. This is not Audio2Face inference.';let phase=0;a2fLocalTtsTimer=setInterval(()=>{phase+=0.7;applyA2FMessage({jawOpen:Math.max(0,Math.min(0.8,Math.abs(Math.sin(phase))*0.65))},false)},110)};
 utterance.onend=()=>{if(a2fLocalTtsTimer)clearInterval(a2fLocalTtsTimer);a2fLocalTtsTimer=null;applyA2FMessage({jawOpen:0},false);a2fStatus.textContent=a2fSocket&&a2fSocket.readyState===WebSocket.OPEN?'Browser TTS preview finished. Real Audio2Face test still requires live bridge frames; watch the frame counter above.':'Browser TTS preview finished. Connect a real Audio2Face bridge to test inferred blendshapes.'};
 utterance.onerror=()=>{if(a2fLocalTtsTimer)clearInterval(a2fLocalTtsTimer);a2fLocalTtsTimer=null;a2fStatus.textContent='Browser TTS playback failed.'};
 speechSynthesis.speak(utterance);
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
  if (!clips.length && !hasModelFitTweaks && !hasGeneratedFace) { persistStatus('No generated face, imported clips, or model-fit changes to export. The existing GLB will be uploaded unchanged.'); return currentModelFile; }
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
    if (hasGeneratedFace || clips.some(entry => entry.source !== 'embedded') || tweakState.headScale !== 1 || tweakState.headOffsetY !== 0 || tweakState.headOffsetZ !== 0) await exportCombinedGlb();
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
