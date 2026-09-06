/* Ground alignment safety patch.
   Keeps networked characters' feet visibly above the voxel surface and
   continuously corrects the local player's vertical position after terrain changes.
*/
(() => {
  const GROUND_LIFT = 0.42;
  const originalSetNetTarget = window.setNetTarget;
  if (typeof originalSetNetTarget === 'function') {
    window.setNetTarget = function(g, x, y, z, yaw) {
      originalSetNetTarget(g, x, y + GROUND_LIFT, z, yaw);
    };
  }

  // The first-person camera is the local player's body position. Keep it locked
  // to the same visible surface height whenever the player is standing.
  setInterval(() => {
    if (typeof me === 'undefined' || typeof groundHeightAt !== 'function') return;
    if (!me.alive || me.permaDead) return;
    const ground = groundHeightAt(me.x, me.z);
    const target = ground + GROUND_LIFT;
    if (me.onGround || me.y < target) {
      me.y = target;
      me.vy = 0;
      me.onGround = true;
      if (typeof camera !== 'undefined') camera.position.y = me.y + me.height;
    }
  }, 50);
})();
