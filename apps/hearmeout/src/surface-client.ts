import { assertAppSurfaceManifestV1 } from "@spmt/contracts/surface";

export const HEARMEOUT_SURFACE_MANIFEST = assertAppSurfaceManifestV1({
  schemaVersion: 1,
  appId: "hearmeout",
  scene: { imageUrl: "/assets/product/hearmeout-background.webp", imagePosition: "center" },
  pages: [
    { id: "home", label: "Home", description: "Hear Me Out home and room shortcuts.", glyph: "\u2302", home: true },
    { id: "rooms", label: "Rooms", description: "Voice rooms, participant cards, personas, DJ, watch sessions, and Discord bridge.", glyph: "\u25c9" },
  ],
  shortcuts: [{ id: "rooms", label: "Rooms", pageId: "rooms" }],
});

const manifest = JSON.stringify(HEARMEOUT_SURFACE_MANIFEST).replace(/</g, "\\u003c");

/** Shell integration only. The app-owned room renderer builds all room cards
 * and controls; this client publishes navigation and workspace events. */
export const HEARMEOUT_SURFACE_BROWSER_JS = String.raw`;(()=>{
const manifest=${manifest},html=document.documentElement;
let hostOrigin='*',lastLaunch='';
const style=document.createElement('style');style.dataset.spmtSurfaceClient='1';
style.textContent=[
'.hmo-app[data-surface="shell"]>.spmt-product-backdrop{display:block!important}',
'.hmo-app[data-surface="shell"] .hmo-stage{height:var(--spmt-shell-available-height,100dvh)!important;min-height:0!important;padding:clamp(8px,1.4vw,18px)!important}',
'.hmo-home[hidden],.hmo-rooms[hidden]{display:none!important}.hmo-app[data-hmo-view="home"] .hmo-rooms{display:none!important}.hmo-app[data-hmo-view="rooms"] .hmo-home{display:none!important}',
'.hmo-app[data-hmo-view="rooms"] .hmo-rooms{display:grid!important;grid-template-rows:auto minmax(0,1fr)!important;height:100%!important;min-height:0!important;overflow:hidden!important}.hmo-page-head{display:none!important}',
'.hmo-home{overflow:hidden!important}.hmo-hero{max-height:100%!important;overflow:hidden!important}.hmo-room-scroll{scrollbar-width:thin;scrollbar-color:transparent transparent}.hmo-room-scroll:hover{scrollbar-color:color-mix(in srgb,var(--spmt-accent) 62%,transparent) transparent}'
].join('');document.head.append(style);
function setMode(mode){html.dataset.spmtSurfaceMode=mode}
function send(message){if(window.parent!==window)window.parent.postMessage(message,hostOrigin)}
function publish(){send({protocol:'spmt.surface',version:1,type:'surface.manifest',manifest})}
function report(pageId){send({protocol:'spmt.surface',version:1,type:'page.changed',appId:manifest.appId,pageId})}
function showDirectory(){closeWatch();window.HearMeOutMedia?.close();const detail=document.querySelector('[data-hmo-room-detail]');if(detail){detail.hidden=true;detail.replaceChildren()}report('rooms')}
function closeWatch(){const watch=document.querySelector('[data-hmo-watch-pane]');if(!watch)return;watch.querySelectorAll('iframe').forEach(frame=>frame.remove());watch.classList.remove('hmo-player-expanded');watch.hidden=true}
function openWatch(selection){const watch=document.querySelector('[data-hmo-watch-pane]');if(!watch)return;watch.hidden=false;if(selection?.partyId)watch.querySelector('iframe')?.remove();if(watch.dataset.hmoBroadcastWindow==='1'&&!watch.querySelector('iframe')){const frame=document.createElement('iframe');frame.dataset.hmoBroadcastFrame='1';frame.src='/watch?embed=1&appRoomId='+encodeURIComponent(watch.closest('.hmo-console')?.dataset.roomId||'')+(selection?.partyId?'&roomId='+encodeURIComponent(selection.partyId)+'&output='+encodeURIComponent(selection.output||'program'):'');frame.title='Watch party player';frame.allow='autoplay; fullscreen';frame.allowFullscreen=true;frame.style.cssText='display:block;border:0;width:100%;height:480px;max-height:58vh;min-width:0;max-width:100%';watch.querySelector('[data-hmo-broadcast-host]')?.replaceChildren(frame)}watch.scrollIntoView({block:'nearest'})}
function openCommlink(context={}){const roomId=context.roomId||document.querySelector('.hmo-console')?.dataset.roomId||'',message={protocol:'spmt.surface',version:1,type:'workspace.open',appId:manifest.appId,service:'commlink',context:{kind:'hearmeout-room',roomId}};if(window.parent!==window){send(message);return}const query=new URLSearchParams({app:'commlink'});if(roomId)query.set('hmoRoomId',roomId);location.assign('/?'+query)}
window.addEventListener('hmo:open-watch',event=>openWatch(event.detail));
window.addEventListener('hmo:close-watch',closeWatch);
window.addEventListener('hmo:open-commlink',event=>openCommlink(event.detail));
window.addEventListener('message',event=>{const frame=document.querySelector('[data-hmo-broadcast-frame]');if(event.origin===location.origin&&event.source===frame?.contentWindow&&event.data?.type==='hmo:player-expanded'){frame.closest('[data-hmo-watch-pane]')?.classList.toggle('hmo-player-expanded',event.data.expanded===true);return}const message=event.data;if(message?.protocol==='spmt.embed'&&message?.version===1&&message?.type==='host.hello'&&message.launch?.appId===manifest.appId){hostOrigin=event.origin||hostOrigin;setMode(message.launch.surfaceMode||'standalone');const launch=JSON.stringify(message.launch);if(launch!==lastLaunch){lastLaunch=launch;publish()}return}if(!message||message.protocol!=='spmt.surface'||message.version!==1||message.type!=='page.open'||message.appId!==manifest.appId)return;if(hostOrigin!=='*'&&event.origin!==hostOrigin)return;if(message.pageId==='rooms')document.querySelector('[data-hmo-open-rooms]')?.click();else if(message.pageId==='home')document.querySelector('[data-hmo-home]')?.click()});
document.querySelector('[data-hmo-open-rooms]')?.addEventListener('click',showDirectory);document.querySelector('[data-hmo-create-home]')?.addEventListener('click',showDirectory);document.querySelector('[data-hmo-home]')?.addEventListener('click',()=>report('home'));
publish();
})();`;
