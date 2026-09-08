/* HUD visibility + reliable crosshair + sniper scope UI safety net. */
(() => {
  function addNormalCrosshair() {
    if (document.getElementById('normalCrosshair')) return;
    const el = document.createElement('div');
    el.id = 'normalCrosshair';
    el.innerHTML = '<i></i><b></b><em></em><span></span>';
    document.body.appendChild(el);
  }

  function ensureUI() {
    const hud = document.getElementById('hud');
    const cross = document.getElementById('crosshair');
    const hot = document.getElementById('hotbar');
    if (hud) { hud.style.display = 'block'; hud.style.visibility = 'visible'; }
    if (cross) { cross.style.display = 'none'; }
    if (hot) { hot.style.display = 'flex'; hot.style.visibility = 'visible'; }
  }

  function addSniperScope() {
    if (document.getElementById('sniperCrosshair')) return;
    const el = document.createElement('div');
    el.id = 'sniperCrosshair';
    el.innerHTML = '<i></i><b></b><em></em><span></span>';
    document.body.appendChild(el);
  }

  function updateScope() {
    const scope = document.getElementById('sniperCrosshair');
    const normal = document.getElementById('normalCrosshair');
    if (!scope || !normal) return;
    let sniper = false;
    try { sniper = typeof currentSlot === 'function' && currentSlot().id === 'sniper'; } catch (_) {}
    const active = typeof running !== 'undefined' && running;
    scope.style.display = sniper && active ? 'block' : 'none';
    normal.style.display = !sniper && active ? 'block' : 'none';
  }

  addNormalCrosshair();
  addSniperScope();
  ensureUI();
  setTimeout(ensureUI, 250);
  setTimeout(ensureUI, 1000);
  setInterval(updateScope, 100);
  document.addEventListener('click', () => { ensureUI(); updateScope(); }, true);
})();
