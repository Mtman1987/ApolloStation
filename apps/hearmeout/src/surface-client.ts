import { assertAppSurfaceManifestV1 } from "@spmt/contracts/surface";

export const HEARMEOUT_SURFACE_MANIFEST = assertAppSurfaceManifestV1({
  schemaVersion: 1,
  appId: "hearmeout",
  scene: { imageUrl: "/assets/product/hearmeout-background.webp", imagePosition: "center" },
  pages: [
    { id: "home", label: "Home", description: "Hear Me Out home and room shortcuts.", glyph: "\u2302", home: true },
    { id: "rooms", label: "Rooms", description: "Voice rooms, people, presence, Bot Hub and watch sessions.", glyph: "\u25c9" },
  ],
  shortcuts: [{ id: "rooms", label: "Rooms", pageId: "rooms" }],
});

const manifest = JSON.stringify(HEARMEOUT_SURFACE_MANIFEST).replace(/</g, "\\u003c");

export const HEARMEOUT_SURFACE_BROWSER_JS = String.raw`;(()=>{
const manifest=${manifest},body=document.body,html=document.documentElement;
let hostOrigin='*',enhanceQueued=false;
const style=document.createElement('style');
style.dataset.spmtSurfaceClient='1';
style.textContent=[
'.hmo-app[data-surface="shell"]>.spmt-product-backdrop{display:block!important}',
'.hmo-app[data-surface="shell"] .hmo-stage{height:var(--spmt-shell-available-height,100dvh)!important;min-height:0!important;padding:clamp(8px,1.4vw,18px)!important}',
'.hmo-home[hidden],.hmo-rooms[hidden]{display:none!important}.hmo-app[data-hmo-view="home"] .hmo-rooms{display:none!important}.hmo-app[data-hmo-view="rooms"] .hmo-home{display:none!important}.hmo-app[data-hmo-view="rooms"] .hmo-rooms{display:grid!important;height:100%!important;min-height:0!important;overflow:hidden!important}',
'.hmo-home{overflow:hidden!important}.hmo-hero{max-height:100%!important;overflow:hidden!important}',
'.hmo-room-scroll{scrollbar-width:thin;scrollbar-color:transparent transparent}.hmo-room-scroll:hover{scrollbar-color:color-mix(in srgb,var(--spmt-accent) 62%,transparent) transparent}.hmo-room-scroll::-webkit-scrollbar{width:4px;height:4px}.hmo-room-scroll::-webkit-scrollbar-track{background:transparent}.hmo-room-scroll::-webkit-scrollbar-thumb{border-radius:99px;background:transparent}.hmo-room-scroll:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--spmt-accent) 62%,transparent)}',
'.hmo-bot-hub{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 9px;padding:8px 9px;border:1px solid var(--spmt-border);border-radius:14px;background:color-mix(in srgb,var(--spmt-surface-depth-2) 90%,transparent)}',
'.hmo-bot-hub-copy{display:grid;gap:2px;min-width:0}.hmo-bot-hub-copy strong{font-size:11px;letter-spacing:.04em}.hmo-bot-hub-copy small{color:var(--spmt-muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
'.hmo-bot-dock{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.hmo-bot-icon{appearance:none;width:38px;height:38px;display:grid;place-items:center;padding:0;border:1px solid var(--spmt-border);border-radius:999px;background:var(--spmt-surface-depth-4);color:var(--spmt-ink);font:inherit;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.16);transition:transform .14s ease,border-color .14s ease,background .14s ease}.hmo-bot-icon:hover,.hmo-bot-icon:focus-visible{transform:translateY(-1px);border-color:var(--spmt-accent-secondary);background:color-mix(in srgb,var(--spmt-accent) 14%,var(--spmt-surface-depth-4));outline:none}.hmo-bot-icon[data-active="true"]{border-color:var(--spmt-accent-secondary);box-shadow:0 0 0 2px color-mix(in srgb,var(--spmt-accent-secondary) 18%,transparent),0 8px 22px rgba(0,0,0,.18)}.hmo-bot-glyph{font-size:17px;line-height:1}',
'.hmo-bot-popover{position:absolute;z-index:55;right:8px;top:calc(100% + 8px);width:min(340px,calc(100vw - 34px));max-height:min(440px,62dvh);overflow:auto;padding:10px;border:1px solid color-mix(in srgb,var(--spmt-accent-secondary) 35%,var(--spmt-border));border-radius:15px;background:color-mix(in srgb,var(--spmt-surface-depth-1) 96%,#050710);backdrop-filter:blur(var(--spmt-blur,18px));box-shadow:0 22px 54px rgba(0,0,0,.42)}.hmo-bot-popover[hidden]{display:none!important}.hmo-bot-popover header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}.hmo-bot-popover header strong{font-size:12px}.hmo-bot-popover header span{color:var(--spmt-accent-secondary);font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.hmo-bot-popover p{margin:0;color:var(--spmt-muted);font-size:10px;line-height:1.45}.hmo-bot-popover-body{display:grid;gap:8px}.hmo-bot-popover .hmo-media-panel,.hmo-bot-popover .hmo-persona-actions{margin:0}.hmo-bot-source-tab{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.hmo-bot-main-mount{display:contents}',
'@media(max-width:560px){.hmo-app[data-surface="shell"] .hmo-stage{padding:8px!important}.hmo-app[data-surface="shell"] .hmo-hero{gap:10px!important;padding:12px!important}.hmo-app[data-surface="shell"] .hmo-hero h1{font-size:clamp(42px,17vw,70px)!important}.hmo-bot-hub{align-items:flex-start}.hmo-bot-hub-copy small{white-space:normal}.hmo-bot-icon{width:36px;height:36px}.hmo-bot-popover{right:0;width:min(320px,calc(100vw - 24px))}}',
'@media(prefers-reduced-motion:reduce){.hmo-bot-icon{transition:none}}'
].join('');
document.head.append(style);

function setMode(mode){html.dataset.spmtSurfaceMode=mode}
function send(message){if(window.parent!==window)window.parent.postMessage(message,hostOrigin)}
function publish(){send({protocol:'spmt.surface',version:1,type:'surface.manifest',manifest})}
function report(pageId){send({protocol:'spmt.surface',version:1,type:'page.changed',appId:manifest.appId,pageId})}
function resetRoomDetail(){const detail=document.querySelector('[data-hmo-room-detail]');if(detail){detail.hidden=true;detail.replaceChildren()}}
function text(node){return String(node&&node.textContent||'').trim()}
function hidePopovers(except){
  document.querySelectorAll('.hmo-bot-popover').forEach(pop=>{if(pop!==except)pop.hidden=true});
  document.querySelectorAll('.hmo-bot-icon').forEach(button=>{const target=button.getAttribute('aria-controls'),open=!!except&&target===except.id&&!except.hidden;button.setAttribute('aria-expanded',open?'true':'false');button.dataset.active=open?'true':'false'});
}
function restorePopoverContent(pop){
  const content=pop.querySelector('[data-media-content]');if(!content)return;
  const pane=pop.closest('.hmo-media-persona'),mount=pane&&pane.querySelector('[data-hmo-bot-main-mount]');if(!pane||!mount)return;
  mount.append(content);
  const watch=[...pane.querySelectorAll('.hmo-tabs button')].find(button=>text(button).toLowerCase().includes('watch'));if(watch)watch.click();
}
function closePopovers(except){
  document.querySelectorAll('.hmo-bot-popover').forEach(pop=>{if(pop!==except&&!pop.hidden)restorePopoverContent(pop)});
  hidePopovers(except);
}
function makePopover(hub,key,title,detail){
  let node=hub.querySelector('[data-hmo-bot-popover="'+key+'"]');
  if(node)return node;
  node=document.createElement('section');
  node.className='hmo-bot-popover';
  node.dataset.hmoBotPopover=key;
  node.id='hmo-bot-popover-'+key;
  node.hidden=true;
  node.setAttribute('role','dialog');
  node.setAttribute('aria-label',title);
  const head=document.createElement('header'),copy=document.createElement('div'),strong=document.createElement('strong'),tag=document.createElement('span'),bodyNode=document.createElement('div');
  strong.textContent=title;tag.textContent='Bot Hub';copy.append(strong,tag);head.append(copy);bodyNode.className='hmo-bot-popover-body';
  if(detail){const p=document.createElement('p');p.textContent=detail;bodyNode.append(p)}
  node.append(head,bodyNode);hub.append(node);return node;
}
function makeIcon(dock,hub,key,label,glyph,detail,onOpen){
  let button=dock.querySelector('[data-hmo-bot-icon="'+key+'"]');
  if(button)return button;
  button=document.createElement('button');button.type='button';button.className='hmo-bot-icon';button.dataset.hmoBotIcon=key;button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-expanded','false');
  const mark=document.createElement('span');mark.className='hmo-bot-glyph';mark.setAttribute('aria-hidden','true');mark.textContent=glyph;button.append(mark);
  const flyout=makePopover(hub,key,label,detail);button.setAttribute('aria-controls',flyout.id);
  button.addEventListener('click',event=>{event.stopPropagation();const opening=flyout.hidden;if(opening){closePopovers(flyout);if(onOpen)onOpen(flyout);flyout.hidden=false;button.setAttribute('aria-expanded','true');button.dataset.active='true'}else closePopovers()});dock.append(button);return button;
}
function relabelSurface(){
  const mark=document.querySelector('.hmo-mark span');if(mark&&text(mark).toUpperCase().includes('PERSONAS'))mark.textContent='VOICE - CHAT - WATCH - BOT HUB';
  document.querySelectorAll('.hmo-feature-strip span').forEach(node=>{if(text(node).toLowerCase().includes('persona'))node.textContent='\u{1f916} Bot Hub'});
  const hero=document.querySelector('.hmo-hero p');if(hero&&text(hero).toLowerCase().includes('configured persona'))hero.textContent='Jump into a room and the controls look like a room: people and voice, chat, a watch queue, and one compact Bot Hub for bridge, music bot, and personas.';
}
function botPane(detail){return detail.querySelector('.hmo-media-persona')}
function mediaContent(pane){return pane.querySelector('[data-media-content]')}
function ensureMainMount(pane,content){
  let mount=pane.querySelector('[data-hmo-bot-main-mount]');
  if(mount)return mount;
  mount=document.createElement('div');mount.className='hmo-bot-main-mount';mount.dataset.hmoBotMainMount='1';content.before(mount);return mount;
}
function restoreContent(pane,mount){const content=mediaContent(pane);if(content&&!content.parentElement?.matches('[data-hmo-bot-main-mount]'))mount.append(content)}
function moveContentTo(pop,pane){const content=mediaContent(pane),bodyNode=pop.querySelector('.hmo-bot-popover-body');if(content&&bodyNode)bodyNode.append(content)}
function enhanceBotHub(){
  relabelSurface();
  const detail=document.querySelector('[data-hmo-room-detail]');if(!detail||detail.hidden)return;
  const pane=botPane(detail);if(!pane)return;
  const content=mediaContent(pane);if(!content)return;
  const mount=ensureMainMount(pane,content);if(content.parentElement===pane)mount.append(content);
  let hub=pane.querySelector('.hmo-bot-hub');
  if(!hub){
    hub=document.createElement('div');hub.className='hmo-bot-hub';
    const copy=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small'),dock=document.createElement('div');copy.className='hmo-bot-hub-copy';strong.textContent='Bot Hub';small.textContent='Bridge - Music Bot - Personas';copy.append(strong,small);dock.className='hmo-bot-dock';dock.dataset.hmoBotDock='1';hub.append(copy,dock);
    const head=pane.querySelector(':scope > header');head&&head.nextSibling?pane.insertBefore(hub,head.nextSibling):pane.prepend(hub);
  }
  const dock=hub.querySelector('[data-hmo-bot-dock]');if(!dock)return;
  makeIcon(dock,hub,'bridge','Bridge','\u21c4','Discord voice bridge controls stay room-scoped and use the existing room bridge authority.');
  const tabs=pane.querySelector('.hmo-tabs');if(!tabs)return;
  const buttons=[...tabs.querySelectorAll('button')],watch=buttons.find(button=>text(button).toLowerCase().includes('watch')),music=buttons.find(button=>text(button).toLowerCase().includes('music')),persona=buttons.find(button=>text(button).toLowerCase().includes('persona'));
  if(watch&&watch.dataset.hmoBotWatchReady!=='1'){
    watch.dataset.hmoBotWatchReady='1';watch.addEventListener('click',()=>{hidePopovers();queueMicrotask(()=>restoreContent(pane,mount))});
  }
  if(music){
    music.classList.add('hmo-bot-source-tab');music.title='Music Bot';music.setAttribute('aria-label','Music Bot');
    const pop=makePopover(hub,'music','Music Bot','Requests, queue, search, playback, and music controls.');
    if(music.dataset.hmoBotReady!=='1'){music.dataset.hmoBotReady='1';music.addEventListener('click',()=>queueMicrotask(()=>moveContentTo(pop,pane)))}
    makeIcon(dock,hub,'music','Music Bot','\u266b','Requests, queue, search, playback, and music controls.',()=>music.click());
  }
  if(persona){
    persona.classList.add('hmo-bot-source-tab');persona.title='Personas';persona.setAttribute('aria-label','Personas');
    const pop=makePopover(hub,'personas','Personas','Add, remove, message, and manage the personas present in this room.');
    if(persona.dataset.hmoBotReady!=='1'){persona.dataset.hmoBotReady='1';persona.addEventListener('click',()=>queueMicrotask(()=>moveContentTo(pop,pane)))}
    makeIcon(dock,hub,'personas','Personas','\u2726','Add, remove, message, and manage the personas present in this room.',()=>persona.click());
  }
  const heading=pane.querySelector('h4');if(heading)heading.textContent='Watch & Bot Hub';
}
function queueEnhance(){if(enhanceQueued)return;enhanceQueued=true;queueMicrotask(()=>{enhanceQueued=false;enhanceBotHub()})}

window.addEventListener('message',event=>{
  const message=event.data;
  if(message?.protocol==='spmt.embed'&&message?.version===1&&message?.type==='host.hello'&&message.launch?.appId===manifest.appId){hostOrigin=event.origin||hostOrigin;setMode(message.launch.surfaceMode||'standalone');publish();return}
  if(!message||message.protocol!=='spmt.surface'||message.version!==1||message.type!=='page.open'||message.appId!==manifest.appId)return;
  if(hostOrigin!=='*'&&event.origin!==hostOrigin)return;
  if(message.pageId==='rooms'){resetRoomDetail();document.querySelector('[data-hmo-open-rooms]')?.click()}
  else if(message.pageId==='home')document.querySelector('[data-hmo-home]')?.click();
});
document.querySelector('[data-hmo-open-rooms]')?.addEventListener('click',()=>{resetRoomDetail();report('rooms')});
document.querySelector('[data-hmo-create-home]')?.addEventListener('click',()=>{resetRoomDetail();report('rooms')});
document.querySelector('[data-hmo-home]')?.addEventListener('click',()=>report('home'));
document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest('button'):null;if(target&&target.closest('.hmo-bot-hub'))return;closePopovers()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closePopovers()});
new MutationObserver(queueEnhance).observe(document.body,{childList:true,subtree:true});
queueEnhance();publish();
})();`;
