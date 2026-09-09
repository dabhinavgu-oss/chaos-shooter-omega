/* HUD visibility + guaranteed crosshair / sniper scope. */
(() => {
  function add(id, html){
    if(document.getElementById(id)) return;
    const el=document.createElement('div'); el.id=id; el.innerHTML=html; document.body.appendChild(el);
  }
  function ensure(){
    add('normalCrosshair','<i></i>');
    add('sniperCrosshair','<i></i><b></b><em></em><span></span>');
    const hud=document.getElementById('hud'),hot=document.getElementById('hotbar');
    if(hud){hud.style.display='block';hud.style.visibility='visible';}
    if(hot){hot.style.display='flex';hot.style.visibility='visible';}
  }
  function update(){
    ensure();
    const n=document.getElementById('normalCrosshair'),s=document.getElementById('sniperCrosshair');
    let sniper=false;
    try{sniper=typeof currentSlot==='function'&&currentSlot().id==='sniper';}catch(_){ }
    n.style.setProperty('display',sniper?'none':'block','important');
    s.style.setProperty('display',sniper?'block':'none','important');
  }
  ensure(); update();
  setTimeout(ensure,250); setTimeout(update,500); setTimeout(update,1500);
  setInterval(update,100);
  document.addEventListener('click',update,true);
})();
