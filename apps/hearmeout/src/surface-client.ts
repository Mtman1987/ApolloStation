import { assertAppSurfaceManifestV1 } from "@spmt/contracts/surface";

export const HEARMEOUT_SURFACE_MANIFEST = assertAppSurfaceManifestV1({
  schemaVersion: 1,
  appId: "hearmeout",
  scene: { imageUrl: "/assets/product/hearmeout-background.webp", imagePosition: "center" },
  pages: [
    { id: "home", label: "Home", description: "Hear Me Out home and room shortcuts.", glyph: "\u2302", home: true },
    { id: "rooms", label: "Rooms", description: "Voice rooms, participant cards, Commlink, bot cards, and watch sessions.", glyph: "\u25c9" },
  ],
  shortcuts: [{ id: "rooms", label: "Rooms", pageId: "rooms" }],
});

const manifest = JSON.stringify(HEARMEOUT_SURFACE_MANIFEST).replace(/</g, "\\u003c");

export const HEARMEOUT_SURFACE_BROWSER_JS = String.raw`;(()=>{
const manifest=${manifest},body=document.body,html=document.documentElement;
let hostOrigin='*';
const style=document.createElement('style');
style.dataset.spmtSurfaceClient='1';
style.textContent=[
'.hmo-app[data-surface="shell"]>.spmt-product-backdrop{display:block!important}',
'.hmo-app[data-surface="shell"] .hmo-stage{height:var(--spmt-shell-available-height,100dvh)!important;min-height:0!important;padding:clamp(8px,1.4vw,18px)!important}',
'.hmo-home[hidden],.hmo-rooms[hidden]{display:none!important}',
'.hmo-app[data-hmo-view="home"] .hmo-rooms{display:none!important}',
'.hmo-app[data-hmo-view="rooms"] .hmo-home{display:none!important}',
'.hmo-app[data-hmo-view="rooms"] .hmo-rooms{display:grid!important;height:100%!important;min-height:0!important;overflow:hidden!important}',
'.hmo-home{overflow:hidden!important}.hmo-hero{max-height:100%!important;overflow:hidden!important}',
'.hmo-room-scroll{scrollbar-width:thin;scrollbar-color:transparent transparent}.hmo-room-scroll:hover{scrollbar-color:color-mix(in srgb,var(--spmt-accent) 62%,transparent) transparent}.hmo-room-scroll::-webkit-scrollbar{width:4px;height:4px}.hmo-room-scroll::-webkit-scrollbar-track{background:transparent}.hmo-room-scroll::-webkit-scrollbar-thumb{border-radius:99px;background:transparent}.hmo-room-scroll:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--spmt-accent) 62%,transparent)}',
'@media(max-width:560px){.hmo-app[data-surface="shell"] .hmo-stage{padding:8px!important}.hmo-app[data-surface="shell"] .hmo-hero{gap:10px!important;padding:12px!important}.hmo-app[data-surface="shell"] .hmo-hero h1{font-size:clamp(42px,17vw,70px)!important}}'
].join('');
document.head.append(style);
function setMode(mode){html.dataset.spmtSurfaceMode=mode}
function send(message){if(window.parent!==window)window.parent.postMessage(message,hostOrigin)}
function publish(){send({protocol:'spmt.surface',version:1,type:'surface.manifest',manifest})}
function report(pageId){send({protocol:'spmt.surface',version:1,type:'page.changed',appId:manifest.appId,pageId})}
function showDirectory(){const detail=document.querySelector('[data-hmo-room-detail]');if(detail){detail.hidden=true;detail.replaceChildren()}report('rooms')}
function relabel(){
  const mark=document.querySelector('.hmo-mark span');if(mark)mark.textContent='VOICE - COMMLINK - WATCH - ROOMS';
  const hero=document.querySelector('.hmo-hero p');if(hero)hero.textContent='Join a voice room, keep chat in Commlink, watch together, and open audio or bot controls only from the participant cards that need them.';
  const features=[...document.querySelectorAll('.hmo-feature-strip span')];
  if(features[0])features[0].textContent='\u{1f399} Voice';
  if(features[1])features[1].textContent='\u{1f4ac} Commlink';
  if(features[2])features[2].textContent='\u{1f3ac} Watch together';
  if(features[3])features[3].textContent='\u{1f465} Participant cards';
}
window.addEventListener('message',event=>{
  const message=event.data;
  if(message?.protocol==='spmt.embed'&&message?.version===1&&message?.type==='host.hello'&&message.launch?.appId===manifest.appId){hostOrigin=event.origin||hostOrigin;setMode(message.launch.surfaceMode||'standalone');publish();return}
  if(!message||message.protocol!=='spmt.surface'||message.version!==1||message.type!=='page.open'||message.appId!==manifest.appId)return;
  if(hostOrigin!=='*'&&event.origin!==hostOrigin)return;
  if(message.pageId==='rooms')document.querySelector('[data-hmo-open-rooms]')?.click();
  else if(message.pageId==='home')document.querySelector('[data-hmo-home]')?.click();
});
document.querySelector('[data-hmo-open-rooms]')?.addEventListener('click',showDirectory);
document.querySelector('[data-hmo-create-home]')?.addEventListener('click',showDirectory);
document.querySelector('[data-hmo-home]')?.addEventListener('click',()=>report('home'));
relabel();publish();
})();`;
