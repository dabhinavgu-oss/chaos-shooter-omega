/* Climbable map structures: lets the local player walk up the visual outpost stairs. */
(() => {
  function syncClimb() {
    try {
      if (typeof running === 'undefined' || !running || typeof me === 'undefined' || !me.alive) return;
      if (typeof getMapGroundHeightAt !== 'function') return;
      const target = getMapGroundHeightAt(me.x, me.z);
      if (target > groundHeightAt(me.x, me.z) + 0.05) {
        const dy = target - me.y;
        // Smoothly step upward, but never yank the player downward off a ledge.
        if (dy > 0 && dy <= 1.0) {
          me.y = target;
          me.vy = 0;
          me.onGround = true;
        }
      }
      // Keep the camera attached after climbing.
      if (typeof camera !== 'undefined') {
        camera.position.set(me.x, me.y + me.height, me.z);
        camera.rotation.order = 'YXZ';
        camera.rotation.set(me.pitch || 0, me.yaw || 0, 0);
      }
    } catch (e) { console.warn('Movement fix:', e); }
  }
  setInterval(syncClimb, 16);
})();
