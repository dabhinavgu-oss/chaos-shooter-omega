/* HUD visibility + sniper scope UI safety net. */
(() => {
  function ensureUI() {
    const hud = document.getElementById('hud');
    const cross = document.getElementById('crosshair');
    const hot = document.getElementById('hotbar');
    if (hud) hud.style.display = 'block';
    if (cross) cross.style.display = 'block';
    if (hot) hot.style.display = 'flex';
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
    if (!scope) return;
    let sniper = false;
    try { sniper = typeof currentSlot === 'function' && currentSlot().id === 'sniper'; } catch (_) {}
    scope.style.display = sniper && typeof running !== 'undefined' && running ? 'block' : 'none';
    const normal = document.getElementById('crosshair');
    if (normal) normal.style.display = sniper ? 'none' : 'block';
  }

  addSniperScope();
  ensureUI();
  setTimeout(ensureUI, 250);
  setTimeout(ensureUI, 1000);
  setInterval(updateScope, 150);

  document.addEventListener('click', () => { ensureUI(); updateScope(); }, true);
})();
