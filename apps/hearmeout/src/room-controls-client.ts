/** Small room-surface controls; the existing persona API remains authoritative. */
export const HEARMEOUT_ROOM_CONTROLS_BROWSER_JS = String.raw`
;(()=>{
function openCommlink(context={}){
  // Use the shared service surface, not a second full workspace or top navigation.
  const url=new URL('/apps/commlink',context.origin||location.origin);
  url.searchParams.set('surface','workspace-service');
  if(context.tenantId)url.searchParams.set('tenantId',context.tenantId);
  const popup=window.open(url.toString(),'spmt-commlink','popup,width=520,height=760,resizable=yes,scrollbars=yes');
  const old=document.querySelector('[data-hmo-commlink-status]');
  if(popup){try{popup.opener=null}catch{}popup.focus();old?.remove();return}
  const status=old||document.createElement('p');
  status.dataset.hmoCommlinkStatus='1';status.className='hmo-status';status.setAttribute('role','status');
  status.textContent='Allow popups to open Commlink. Your voice room is still connected.';
  if(!old)(document.querySelector('.hmo-console-head')||document.body).append(status);
}
function enhancePersonas(root){
  for(const input of root.querySelectorAll('.hmo-persona-actions textarea')){
    const submit=input.nextElementSibling;
    if(!submit||submit.tagName!=='BUTTON'||submit.dataset.hmoPersonaSend==='1'||!submit.textContent.startsWith('Call '))continue;
    const name=submit.textContent.slice(5).trim();
    submit.dataset.hmoPersonaSend='1';submit.textContent='Send';
    submit.setAttribute('aria-label','Send message to '+name);
    input.setAttribute('aria-label','Message '+name);
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();if(!submit.disabled)submit.click()}
    });
    // Capture before the existing request handler: an empty message must not fail silently.
    submit.addEventListener('click',event=>{
      if(input.value.trim())return;
      event.preventDefault();event.stopImmediatePropagation();
      const status=input.closest('.hmo-persona-actions')?.querySelector('.hmo-status');
      if(status)status.textContent='Type a message for '+name+', or use Talk to '+name+' for your microphone.';
      input.focus();
    },{capture:true});
  }
}
window.HearMeOutRoomControls={openCommlink,enhancePersonas};
})();`;
