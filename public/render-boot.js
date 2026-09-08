/* Fallback render boot: make the voxel world visible immediately, even if the server init packet is delayed. */
(() => {
  const boot = () => {
    try {
      if (typeof buildTerrain === 'function' && typeof scene !== 'undefined' && typeof WORLD !== 'undefined') {
        if (!heightMap.length || !heightMap[0] || heightMap[0].length !== WORLD) buildTerrain();
        if (typeof camera !== 'undefined' && typeof groundHeightAt === 'function' && typeof me !== 'undefined') {
          me.y = groundHeightAt(me.x, me.z);
          camera.position.set(me.x, me.y + me.height, me.z);
          camera.rotation.order = 'YXZ';
          camera.rotation.set(me.pitch || 0, me.yaw || 0, 0);
        }
      }
    } catch (e) { console.warn('Render boot:', e); }
  };
  setTimeout(boot, 0);
  setTimeout(boot, 250);
})();
