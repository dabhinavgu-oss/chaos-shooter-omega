/* Fallback for the lobby->game handoff. The home screen uses a programmatic click,
   so make sure the shooter is definitely armed and the first frame is positioned. */
(() => {
  document.addEventListener('click', (e) => {
    const play = e.target && e.target.closest ? e.target.closest('#playSelected') : null;
    if (!play) return;
    setTimeout(() => {
      try {
        running = true;
        me.alive = true;
        me.permaDead = false;
        if (typeof buildTerrain === 'function' && (!heightMap.length || !heightMap[0])) buildTerrain();
        if (typeof rebuildHotbar === 'function') rebuildHotbar();
        if (typeof groundHeightAt === 'function') {
          me.y = groundHeightAt(me.x, me.z);
          camera.position.set(me.x, me.y + me.height, me.z);
          camera.rotation.order = 'YXZ';
          camera.rotation.set(me.pitch || 0, me.yaw || 0, 0);
        }
        if (canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      } catch (err) { console.warn('Play control fix:', err); }
    }, 50);
  });

  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });
})();
