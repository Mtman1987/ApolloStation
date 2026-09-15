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
let hostOrigin='*',lastLaunch='';
const style=document.createElement('style');
style.dataset.spmtSurfaceClient='1';
style.textContent=[
'.hmo-remote-person{display:flex!important;align-items:center;gap:12px;flex-wrap:wrap}.hmo-remote-person .hmo-persona-avatar{width:48px;height:48px;flex:0 0 48px;border-radius:50%;object-fit:cover}.hmo-remote-person[data-speaking]{outline:2px solid var(--spmt-accent-secondary,#57d9cf)}.hmo-discord-members{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px}.hmo-discord-members span{padding:3px 8px;border-radius:12px;background:#ffffff0c}.hmo-discord-members [data-speaking]{color:var(--spmt-accent-secondary,#57d9cf)}',
'.hmo-app[data-surface="shell"]>.spmt-product-backdrop{display:block!important}',
'.hmo-app[data-surface="shell"] .hmo-stage{height:var(--spmt-shell-available-height,100dvh)!important;min-height:0!important;padding:clamp(8px,1.4vw,18px)!important}',
'.hmo-home[hidden],.hmo-rooms[hidden]{display:none!important}',
'.hmo-app[data-hmo-view="home"] .hmo-rooms{display:none!important}',
'.hmo-app[data-hmo-view="rooms"] .hmo-home{display:none!important}',
'.hmo-app[data-hmo-view="rooms"] .hmo-rooms{display:grid!important;grid-template-rows:auto minmax(0,1fr)!important;height:100%!important;min-height:0!important;overflow:hidden!important}',
'.hmo-page-head{display:none!important}',
'.hmo-home{overflow:hidden!important}.hmo-hero{max-height:100%!important;overflow:hidden!important}',
'.hmo-room-scroll{scrollbar-width:thin;scrollbar-color:transparent transparent}.hmo-room-scroll:hover{scrollbar-color:color-mix(in srgb,var(--spmt-accent) 62%,transparent) transparent}.hmo-room-scroll::-webkit-scrollbar{width:4px;height:4px}.hmo-room-scroll::-webkit-scrollbar-track{background:transparent}.hmo-room-scroll::-webkit-scrollbar-thumb{border-radius:99px;background:transparent}.hmo-room-scroll:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--spmt-accent) 62%,transparent)}',
'.hmo-console{height:100%!important;min-height:0!important}.hmo-console-head .hmo-toolbar{display:none!important}.hmo-console-head h3{font-size:clamp(24px,3vw,34px)!important}.hmo-console-grid{align-items:start!important}.hmo-console-grid>[data-hmo-watch-pane]{display:none!important}',
'[data-hmo-screen][hidden]{display:none!important}',
'.hmo-screen-stage{grid-column:1/-1!important;min-width:0!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;height:min(56vw,480px)!important;contain:inline-size!important;border:1px solid color-mix(in srgb,var(--spmt-accent-secondary) 55%,var(--spmt-border));border-radius:14px;overflow:hidden;background:#000;box-shadow:0 12px 36px #0008}.hmo-screen-stage[hidden]{display:none!important}.hmo-screen-stage:not([hidden]){display:grid!important;place-items:center!important}.hmo-screen-stage video{display:block!important;width:100%!important;min-width:0!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;background:#000!important}',
'.hmo-watch-drawer.hmo-player-expanded{position:fixed!important;inset:12px!important;z-index:1000!important;margin:0!important;max-height:none!important;background:#080d18!important}.hmo-watch-drawer.hmo-player-expanded iframe{height:calc(100dvh - 100px)!important;max-height:none!important}',
'.hmo-watch-drawer{grid-column:1/-1!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important;contain:inline-size!important;margin-top:8px!important;max-height:min(58vh,520px)!important;border-color:color-mix(in srgb,var(--spmt-accent-secondary) 55%,var(--spmt-border))!important}.hmo-watch-drawer[hidden]{display:none!important}.hmo-watch-drawer:not([hidden]){display:block!important}',
'.hmo-room-tools{margin:8px 0 0!important;padding:10px!important;border:1px solid color-mix(in srgb,var(--spmt-accent) 45%,var(--spmt-border));border-radius:14px;background:color-mix(in srgb,var(--spmt-panel) 94%,transparent)}.hmo-room-tools[hidden]{display:none!important}.hmo-room-tools .hmo-button{width:100%!important;margin:3px 0!important}',
'.hmo-person .hmo-person-menu{display:none!important}.hmo-person,.hmo-bot-person,.hmo-remote-person{min-width:0!important;max-width:100%!important;box-sizing:border-box!important;align-self:start!important}',
'.hmo-bot-person{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px!important;margin:8px 0;border:1px solid color-mix(in srgb,var(--spmt-accent-secondary) 42%,var(--spmt-border));border-radius:14px;background:#ffffff05}.hmo-bot-person .hmo-bot-avatar{width:46px;height:46px;border-radius:50%;object-fit:cover;background:#ffffff0a}.hmo-bot-person .hmo-bot-copy{min-width:0}.hmo-bot-person .hmo-bot-name{font-weight:800}.hmo-bot-person .hmo-bot-sub{font-size:12px;opacity:.7;margin-top:2px}.hmo-bot-person .hmo-bot-actions{display:flex;gap:6px}.hmo-bot-person textarea,.hmo-bot-person button[aria-label="Send message to persona"]{display:none!important}.hmo-bot-person .hmo-talk-button{grid-column:1/-1;width:100%!important;margin-top:3px!important}',
'.hmo-bot-drawer .hmo-bot-tabs{margin-bottom:8px}.hmo-bot-drawer textarea{min-height:0!important}',
'@media(max-width:560px){.hmo-app[data-surface="shell"] .hmo-stage{padding:8px!important}.hmo-app[data-surface="shell"] .hmo-hero{gap:10px!important;padding:12px!important}.hmo-app[data-surface="shell"] .hmo-hero h1{font-size:clamp(42px,17vw,70px)!important}.hmo-screen-stage video{max-height:44vh!important}.hmo-bot-person{grid-template-columns:auto minmax(0,1fr)!important}.hmo-bot-person .hmo-bot-actions{grid-column:1/-1!important}}'
].join('');
document.head.append(style);
function setMode(mode){html.dataset.spmtSurfaceMode=mode}
function send(message){if(window.parent!==window)window.parent.postMessage(message,hostOrigin)}
function publish(){send({protocol:'spmt.surface',version:1,type:'surface.manifest',manifest})}
function report(pageId){send({protocol:'spmt.surface',version:1,type:'page.changed',appId:manifest.appId,pageId})}
function openCommlink(){
  if(window.parent!==window){send({protocol:'spmt.surface',version:1,type:'workspace.open',appId:manifest.appId,service:'commlink'});return}
  location.assign('/?app=commlink')
}
function showDirectory(){closeWatch();window.HearMeOutMedia?.close();const detail=document.querySelector('[data-hmo-room-detail]');if(detail){detail.hidden=true;detail.replaceChildren()}report('rooms')}
function closeWatch(){const watch=document.querySelector('[data-hmo-watch-drawer]');if(!watch)return;watch.querySelectorAll('iframe').forEach(frame=>frame.remove());watch.classList.remove('hmo-player-expanded');watch.hidden=true;document.querySelector('[data-hmo-watch-icon]')?.setAttribute('aria-expanded','false')}
function openWatch(selection){const watch=document.querySelector('[data-hmo-watch-drawer]');if(!watch)return;watch.hidden=false;document.querySelector('[data-hmo-watch-icon]')?.setAttribute('aria-expanded','true');if(selection?.partyId)watch.querySelector('iframe')?.remove();if(watch.dataset.hmoBroadcastWindow==='1'&&!watch.querySelector('iframe')){const frame=document.createElement('iframe');frame.dataset.hmoBroadcastFrame='1';frame.src='/watch?embed=1&appRoomId='+encodeURIComponent(watch.closest('.hmo-console')?.dataset.roomId||'')+(selection?.partyId?'&roomId='+encodeURIComponent(selection.partyId)+'&output='+encodeURIComponent(selection.output||'program'):'');frame.title='Watch party player';frame.allow='autoplay; fullscreen';frame.allowFullscreen=true;frame.style.cssText='display:block;border:0;width:100%;height:480px;max-height:58vh;min-width:0;max-width:100%';watch.querySelector('[data-hmo-broadcast-host]').replaceChildren(frame)}watch.scrollIntoView({block:'nearest'})}
window.addEventListener('message',event=>{const frame=document.querySelector('[data-hmo-broadcast-frame]');if(event.origin===location.origin&&event.source===frame?.contentWindow&&event.data?.type==='hmo:player-expanded')frame.closest('[data-hmo-watch-drawer]')?.classList.toggle('hmo-player-expanded',event.data.expanded===true)});
window.addEventListener('hmo:close-watch',closeWatch);
window.addEventListener('hmo:open-watch',event=>openWatch(event.detail));
function makeIcon(label,title,hook){const button=document.createElement('button');button.type='button';button.className='hmo-icon';button.textContent=label;button.title=title;button.setAttribute('aria-label',title);button.dataset[hook]='1';return button}
function enhancePersonaControls(room){
  for(const textarea of room.querySelectorAll('textarea[placeholder^="Message "]')){
    const wrap=textarea.parentElement;if(!wrap)continue;
    const sendButton=[...wrap.querySelectorAll('button')].find(button=>/^Call\s+|^Send$/.test(button.textContent||''));
    const talk=[...wrap.querySelectorAll('button')].find(button=>/^Talk to\s+/.test(button.textContent||''));
    if(sendButton){sendButton.textContent='Send';sendButton.setAttribute('aria-label','Send message to persona')}
    if(talk)talk.classList.add('hmo-talk-button');
    if(!wrap.classList.contains('hmo-bot-person')){
      const name=(textarea.getAttribute('placeholder')||'Message Persona').replace(/^Message\s+/,'').replace(/…|\.\.\.$/,'').trim()||'Persona';
      wrap.classList.add('hmo-bot-person');
      const avatar=document.createElement('div');avatar.className='hmo-bot-avatar';avatar.textContent='🤖';avatar.setAttribute('aria-hidden','true');avatar.style.display='grid';avatar.style.placeItems='center';
      const copy=document.createElement('div');copy.className='hmo-bot-copy';const title=document.createElement('div');title.className='hmo-bot-name';title.textContent=name;const sub=document.createElement('div');sub.className='hmo-bot-sub';sub.textContent='Room persona · text in Commlink or use voice here';copy.append(title,sub);
      const actions=document.createElement('div');actions.className='hmo-bot-actions';const chat=makeIcon('💬','Open Commlink','hmoPersonaCommlink');chat.addEventListener('click',openCommlink);actions.append(chat);
      wrap.prepend(avatar,copy,actions);
    }
    if(!textarea.dataset.hmoEnterSend){textarea.dataset.hmoEnterSend='1';textarea.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendButton?.click()}})}
  }
}
function relocateRoomTools(own,icons){
  const menu=own.querySelector('.hmo-person-menu');if(!menu)return;
  let tools=own.parentElement?.querySelector(':scope > .hmo-room-tools');
  if(!tools){tools=document.createElement('div');tools.className='hmo-room-tools';tools.hidden=true;while(menu.firstChild)tools.append(menu.firstChild);own.after(tools);menu.remove()}
  const more=[...icons.querySelectorAll('.hmo-icon')].find(button=>button.getAttribute('aria-label')==='More');
  if(more&&!more.dataset.hmoRoomTools){more.dataset.hmoRoomTools='1';more.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();tools.hidden=!tools.hidden;if(!tools.hidden)tools.scrollIntoView({block:'nearest'})},{capture:true})}
}
function enhanceRoom(){
  const room=document.querySelector('.hmo-console');if(!room)return;
  room.querySelector('.hmo-console-head .hmo-toolbar')?.remove();
  const grid=room.querySelector('.hmo-console-grid');if(!grid)return;
  const screens=grid.querySelector('[data-hmo-screens]');if(screens)screens.classList.add('hmo-screen-stage');
  const direct=[...grid.children];
  const people=direct.find(node=>node.classList?.contains('hmo-pane')&&node.querySelector('h4')?.textContent?.trim()==='People')||grid.querySelector('.hmo-pane');
  if(!people)return;
  enhancePersonaControls(room);
  const own=people.querySelector('[data-mic-button]')?.closest('.hmo-person');if(!own)return;
  const icons=own.querySelector('.hmo-person-icons');if(!icons)return;
  const more=[...icons.querySelectorAll('.hmo-icon')].find(button=>button.getAttribute('aria-label')==='More')||null;
  if(!own.querySelector('[data-hmo-commlink-icon]')){
    const chat=makeIcon('💬','Open Commlink','hmoCommlinkIcon');
    chat.addEventListener('click',openCommlink);
    icons.insertBefore(chat,more);
  }
  let watch=own.querySelector('[data-hmo-watch-drawer]');
  if(!watch){
    const candidate=direct.find(node=>node.hasAttribute('data-hmo-watch-pane')||node.classList?.contains('hmo-pane')&&node.querySelector('h4')?.textContent?.trim()==='Watch together');
    if(candidate){candidate.dataset.hmoWatchDrawer='1';candidate.classList.add('hmo-watch-drawer');candidate.hidden=true;own.append(candidate);watch=candidate}
  }
  if(watch&&!own.querySelector('[data-hmo-watch-icon]')){
    const watchButton=makeIcon('🎬','Watch party player','hmoWatchIcon');
    watchButton.setAttribute('aria-expanded','false');
    watchButton.addEventListener('click',()=>{if(watch.hidden)openWatch();else closeWatch()});
    const close=makeIcon('×','Close watch party player','hmoCloseWatch');close.addEventListener('click',closeWatch);watch.querySelector('header')?.append(close);
    icons.insertBefore(watchButton,more);
  }
  const bots=people.querySelector('[data-bot-drawer]');
  if(bots&&!own.querySelector('[data-hmo-bots-icon]')){
    const botButton=makeIcon('🤖','Bots & personas','hmoBotsIcon');
    botButton.addEventListener('click',()=>{
      bots.hidden=!bots.hidden;
      if(!bots.hidden){
        const personaTab=[...bots.querySelectorAll('.hmo-bot-tabs .hmo-button')].find(button=>button.textContent?.includes('Personas'));
        personaTab?.click();
        enhancePersonaControls(room);
        bots.scrollIntoView({block:'nearest'});
      }
    });
    icons.insertBefore(botButton,more);
  }
  relocateRoomTools(own,icons);
}
function relabel(){
  const mark=document.querySelector('.hmo-mark span');if(mark)mark.textContent='VOICE - COMMLINK - WATCH - ROOMS';
  const hero=document.querySelector('.hmo-hero p');if(hero)hero.textContent='Join a voice room, keep chat in Commlink, watch together, and open audio, watch, bot, bridge, or moderation controls only when you need them.';
  const features=[...document.querySelectorAll('.hmo-feature-strip span')];
  if(features[0])features[0].textContent='🎙 Voice';
  if(features[1])features[1].textContent='💬 Commlink';
  if(features[2])features[2].textContent='🎬 Watch together';
  if(features[3])features[3].textContent='👥 Participant cards';
}
window.addEventListener('message',event=>{
  const message=event.data;
  if(message?.protocol==='spmt.embed'&&message?.version===1&&message?.type==='host.hello'&&message.launch?.appId===manifest.appId){hostOrigin=event.origin||hostOrigin;setMode(message.launch.surfaceMode||'standalone');const launch=JSON.stringify(message.launch);if(launch!==lastLaunch){lastLaunch=launch;publish()}return}
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
