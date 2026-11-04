/** A read-only live indicator. Refreshing never changes either currency. */
export function streamWeaverPointsRateBrowserJs() { return String.raw`
;(()=>{
  const root=(location.pathname.startsWith('/apps/streamweaver')?'/apps/streamweaver/api/control':'/api/streamweaver/control')+'/economy/rate';
  let busy=false;
  const number=value=>new Intl.NumberFormat(undefined,{maximumSignificantDigits:10}).format(value);
  function card(){
    const page=document.querySelector('[data-spmt-live-slot="economy"]');
    if(!page||document.hidden||!page.getClientRects().length)return null;
    let node=page.querySelector('[data-points-rate]');
    if(!node){
      node=document.createElement('article');node.className='sw-card';node.setAttribute('data-points-rate','');
      node.innerHTML='<h3>Current SPMT value</h3><p data-rate-forward>Loading current totals…</p><p data-rate-reverse></p><p data-rate-totals></p><small data-rate-time></small><p>Updates every 5 seconds while this page is open. This is a value comparison; it does not convert points.</p><button type="button" class="button" data-rate-refresh>Refresh rate</button>';
      (page.querySelector('.sw-grid')||page).prepend(node);
    }
    return node;
  }
  async function refresh(){
    const node=card();if(!node||busy)return;busy=true;
    try{
      const response=await fetch(root,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)}),rate=await response.json();
      if(!response.ok)throw new Error('Current totals are unavailable. Retrying automatically.');
      node.querySelector('[data-rate-forward]').textContent=rate.available?'1 SPMT XP = '+number(rate.streamerPointsPerXp)+' '+rate.currencyName:rate.message;
      node.querySelector('[data-rate-reverse]').textContent=rate.available?'1 '+rate.currencyName+' = '+number(rate.xpPerStreamerPoint)+' SPMT XP':'';
      node.querySelector('[data-rate-totals]').textContent='Outstanding: '+number(rate.streamerPoints)+' '+rate.currencyName+' · '+number(rate.spmtPoints)+' spendable SPMT XP';
      node.querySelector('[data-rate-time]').textContent='Updated '+new Date(rate.measuredAt).toLocaleTimeString();
    }catch(error){
      node.querySelector('[data-rate-forward]').textContent='Rate unavailable';
      node.querySelector('[data-rate-reverse]').textContent='';
      node.querySelector('[data-rate-time]').textContent=error.message;
    }finally{busy=false}
  }
  document.addEventListener('click',event=>{if(event.target.closest('[data-rate-refresh],[data-nav="economy"]'))setTimeout(()=>void refresh(),0)});
  document.addEventListener('visibilitychange',()=>void refresh());
  window.addEventListener('focus',()=>void refresh());
  window.addEventListener('spmt:currency-changed',()=>void refresh());
  window.addEventListener('spmt:snapshot',()=>void refresh());
  setInterval(()=>void refresh(),5000);
  setTimeout(()=>void refresh(),0);
})();`; }
