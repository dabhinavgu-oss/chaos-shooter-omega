/* Map boot layer: passes the selected lobby map to the server. */
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

  // The lobby's PLAY button already calls the original game start handler.
  // Do not intercept it or reload the page: that used to make PLAY appear broken.
})();
