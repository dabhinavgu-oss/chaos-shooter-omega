/* HUD visibility + reliable crosshair + sniper scope UI safety net. */
(() => {
  function addNormalCrosshair() {
    if (document.getElementById('normalCrosshair')) return;
    const el = document.createElement('div');
    el.id = 'normalCrosshair';
    el.innerHTML = '<i></i>';
    document.body.appendChild(el);
  }
  function addSniperScope() {
    if (document.getElementById('sniperCrosshair')) return;
    const el = document.createElement('div');
    el.id = 'sniperCrosshair';
    el.innerHTML = '<i></i><b></b><em></em><span></span>';
    document.body.appendChild(el);
  }
  function ensureUI() {
    const hud=document.getElementById('hud'), hot=document.getElementById('hotbar');
    if(hud){hud.style.display='block';hud.style.visibility='visible';}
    if(hot){hot.style.display='flex';hot.style.visibility='visible';}
  }
  function updateScope() {
    const scope=document.getElementById('sniperCrosshair'), normal=document.getElementById('normalCrosshair');
    if(!scope||!normal)return;
    let sniper=false;
    try{sniper=typeof currentSlot==='function'&&currentSlot().id==='sniper';}catch(_){ }
    const active=typeof running!=='undefined'&&running;
    normal.style.setProperty('display', (!sniper&&active)?'block':'none', 'important');
    scope.style.setProperty('display', (sniper&&active)?'block':'none', 'important');
  }
  addNormalCrosshair(); addSniperScope(); ensureUI();
  setTimeout(ensureUI,250); setTimeout(ensureUI,1000);
  setInterval(updateScope,50);
  document.addEventListener('click',()=>{ensureUI();updateScope();},true);
})();
