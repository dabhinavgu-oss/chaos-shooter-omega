/* Terrain safety + climbable map structures. */
(() => {
  const baseGround = typeof groundHeightAt === 'function' ? groundHeightAt : null;
  function ground(x,z){
    let h=baseGround ? baseGround(x,z) : 0;
    try { if(typeof window.getMapGroundHeightAt==='function') h=Math.max(h,window.getMapGroundHeightAt(x,z)); } catch(_){}
    return h;
  }
  function sync(){
    try{
      if(typeof running==='undefined'||!running||typeof me==='undefined'||!me.alive)return;
      const target=ground(me.x,me.z);
      if(me.y < target){ me.y=target; me.vy=0; me.onGround=true; }
      else if(typeof window.getMapGroundHeightAt==='function' && target > (baseGround?baseGround(me.x,me.z):target)+0.05){
        const dy=target-me.y;
        if(dy>0 && dy<=1.25){me.y=target;me.vy=0;me.onGround=true;}
      }
      if(typeof camera!=='undefined'){
        camera.position.set(me.x,me.y+me.height,me.z);
        camera.rotation.order='YXZ'; camera.rotation.set(me.pitch||0,me.yaw||0,0);
      }
      if(typeof socket!=='undefined') socket.emit('move',{x:me.x,y:me.y,z:me.z,yaw:me.yaw});
      if(typeof enemyMeshes!=='undefined'){
        for(const id in enemyMeshes){
          const g=enemyMeshes[id], n=g&&g.userData&&g.userData.net;
          if(!g||!n||!g.visible)continue;
          const eh=ground(n.x,n.z);
          if(g.position.y < eh && eh-g.position.y<=4){g.position.y=eh;n.y=eh;}
        }
      }
    }catch(e){console.warn('Movement fix:',e);}
  }
  setInterval(sync,16);
})();
