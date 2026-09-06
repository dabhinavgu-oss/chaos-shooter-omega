/* Ground alignment safety patch.
   Keeps networked characters' feet exactly on the voxel surface and
   continuously corrects the local player's vertical position after terrain changes.
*/
(() => {
  const originalSetNetTarget = window.setNetTarget;
  if (typeof originalSetNetTarget === 'function') {
    window.setNetTarget = function(g, x, y, z, yaw) {
      // Network y is the terrain surface. Give character models a tiny visual
      // lift so their feet never disappear into the top voxel face.
      originalSetNetTarget(g, x, y + 0.08, z, yaw);
    };
  }

  // Safety net for the locally predicted player. Never allow the camera/feet
  // to remain below the authoritative voxel surface.
  setInterval(() => {
    if (typeof me === 'undefined' || typeof groundHeightAt !== 'function') return;
    if (!me.alive || me.permaDead) return;
    const ground = groundHeightAt(me.x, me.z);
    if (me.y < ground) {
      me.y = ground;
      me.vy = 0;
      me.onGround = true;
      if (typeof camera !== 'undefined') camera.position.y = me.y + me.height;
    }
  }, 50);
})();
