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
'.hmo-app[data-hmo-view="rooms"] .hmo-rooms{display:grid!important;grid-template-rows:auto minmax(0,1fr)!important;height:100%!important;min-height:0!important;overflow:hidden!important}',
'.hmo-page-head{display:none!important}',
'.hmo-home{overflow:hidden!important}.hmo-hero{max-height:100%!important;overflow:hidden!important}',
'.hmo-room-scroll{scrollbar-width:thin;scrollbar-color:transparent transparent}.hmo-room-scroll:hover{scrollbar-color:color-mix(in srgb,var(--spmt-accent) 62%,transparent) transparent}.hmo-room-scroll::-webkit-scrollbar{width:4px;height:4px}.hmo-room-scroll::-webkit-scrollbar-track{background:transparent}.hmo-room-scroll::-webkit-scrollbar-thumb{border-radius:99px;background:transparent}.hmo-room-scroll:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--spmt-accent) 62%,transparent)}',
'.hmo-console{height:100%!important;min-height:0!important}.hmo-console-head .hmo-toolbar{display:none!important}.hmo-console-head h3{font-size:clamp(24px,3vw,34px)!important}.hmo-console-grid{grid-template-columns:minmax(0,1fr)!important}.hmo-console-grid>.hmo-pane:nth-child(2){display:none!important}',
'.hmo-watch-drawer{grid-column:1/-1!important;margin-top:8px!important;max-height:min(58vh,520px)!important;border-color:color-mix(in srgb,var(--spmt-accent-secondary) 55%,var(--spmt-border))!important}.hmo-watch-drawer[hidden]{display:none!important}.hmo-watch-drawer:not([hidden]){display:block!important}',
'@media(max-width:560px){.hmo-app[data-surface="shell"] .hmo-stage{padding:8px!important}.hmo-app[data-surface="shell"] .hmo-hero{gap:10px!important;padding:12px!important}.hmo-app[data-surface="shell"] .hmo-hero h1{font-size:clamp(42px,17vw,70px)!important}}'
].join('');
document.head.append(style);
function setMode(mode){html.dataset.spmtSurfaceMode=mode}
function send(message){if(window.parent!==window)window.parent.postMessage(message,hostOrigin)}
function publish(){send({protocol:'spmt.surface',version:1,type:'surface.manifest',manifest})}
function report(pageId){send({protocol:'spmt.surface',version:1,type:'page.changed',appId:manifest.appId,pageId})}
function showDirectory(){const detail=document.querySelector('[data-hmo-room-detail]');if(detail){detail.hidden=true;detail.replaceChildren()}report('rooms')}
function makeIcon(label,title,hook){const button=document.createElement('button');button.type='button';button.className='hmo-icon';button.textContent=label;button.title=title;button.setAttribute('aria-label',title);button.dataset[hook]='1';return button}
function enhanceRoom(){
  const room=document.querySelector('.hmo-console');if(!room)return;
  room.querySelector('.hmo-console-head .hmo-toolbar')?.remove();
  const grid=room.querySelector('.hmo-console-grid');if(!grid)return;
  const direct=[...grid.children];
  const people=direct.find(node=>node.classList?.contains('hmo-pane')&&node.querySelector('h4')?.textContent?.trim()==='People')||grid.querySelector('.hmo-pane');
  if(!people)return;
  const own=people.querySelector('[data-mic-button]')?.closest('.hmo-person');if(!own)return;
  const icons=own.querySelector('.hmo-person-icons');if(!icons)return;
  const more=[...icons.querySelectorAll('.hmo-icon')].find(button=>button.getAttribute('aria-label')==='More')||null;
  if(!own.querySelector('[data-hmo-commlink-icon]')){
    const chat=makeIcon('\u{1f4ac}','Open Commlink','hmoCommlinkIcon');
    chat.addEventListener('click',()=>window.open('/?app=commlink','_top'));
    icons.insertBefore(chat,more);
  }
  let watch=own.querySelector('[data-hmo-watch-drawer]');
  if(!watch){
    const candidate=direct.find(node=>node.classList?.contains('hmo-pane')&&node.querySelector('h4')?.textContent?.trim()==='Watch together');
    if(candidate){candidate.dataset.hmoWatchDrawer='1';candidate.classList.add('hmo-watch-drawer');candidate.hidden=true;own.append(candidate);watch=candidate}
  }
  if(watch&&!own.querySelector('[data-hmo-watch-icon]')){
    const watchButton=makeIcon('\u{1f3ac}','Watch party','hmoWatchIcon');
    watchButton.addEventListener('click',()=>{watch.hidden=!watch.hidden;if(!watch.hidden)watch.scrollIntoView({block:'nearest'})});
    icons.insertBefore(watchButton,more);
  }
  const menu=own.querySelector('.hmo-person-menu');
  if(menu){for(const button of [...menu.querySelectorAll('.hmo-button')])if(button.textContent?.includes('Open Commlink'))button.remove()}
}
function relabel(){
  const mark=document.querySelector('.hmo-mark span');if(mark)mark.textContent='VOICE - COMMLINK - WATCH - ROOMS';
  const hero=document.querySelector('.hmo-hero p');if(hero)hero.textContent='Join a voice room, keep chat in Commlink, watch together, and open audio, watch, bot, or moderation controls only when you need them.';
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
new MutationObserver(enhanceRoom).observe(document.body,{childList:true,subtree:true});
relabel();enhanceRoom();publish();
})();`;
