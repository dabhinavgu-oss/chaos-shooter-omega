/* Map boot layer: passes the selected lobby map to the server and makes PLAY load it. */
(() => {
  const originalIo = window.io;
  if (typeof originalIo === 'function') {
    window.io = function(...args) {
      const opts = (args[1] && typeof args[1] === 'object') ? args[1] : {};
      const query = Object.assign({}, opts.query || {}, { map: localStorage.getItem('cso_map') || 'delta' });
      args[1] = Object.assign({}, opts, { query });
      return originalIo.apply(this, args);
    };
    Object.keys(originalIo).forEach(k => { try { window.io[k] = originalIo[k]; } catch {} });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('#playSelected');
    if (!btn) return;
    const selected = document.querySelector('.csoMap.selected');
    if (selected?.dataset?.map) localStorage.setItem('cso_map', selected.dataset.map);
    e.preventDefault();
    e.stopImmediatePropagation();
    window.setTimeout(() => window.location.reload(), 0);
  }, true);
})();
