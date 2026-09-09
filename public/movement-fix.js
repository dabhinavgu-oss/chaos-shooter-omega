/* Terrain safety + climbable map structures. */
(() => {
  const baseGround = typeof groundHeightAt === 'function' ? groundHeightAt : null;
  function ground(x,z){
    let h=baseGround ? baseGround(x,z) : 0;
    try { if(typeof window.getMapGroundHeightAt==='function') h=Math.max(h,window.getMapGroundHeightAt(x,z)); } catch(_){}
    return h;
  }
  // Clamp network targets before the normal interpolation can pull meshes below the floor.
  if(typeof window.setNetTarget==='function'){
    const originalSetNetTarget=window.setNetTarget;
    window.setNetTarget=function(g,x,y,z,yaw){
      try { y=Math.max(y,ground(x,z)); } catch(_){}
      return originalSetNetTarget(g,x,y,z,yaw);
    };
  }
  function sync(){
    try{
      if(typeof me!=='undefined' && typeof running!=='undefined' && running && me.alive){
        const target=ground(me.x,me.z);
        if(me.y < target){me.y=target;me.vy=0;me.onGround=true;}
        else if(typeof window.getMapGroundHeightAt==='function'){
          const base=baseGround?baseGround(me.x,me.z):target;
          if(target>base+0.05 && target-me.y>0 && target-me.y<=1.5){me.y=target;me.vy=0;me.onGround=true;}
        }
        if(typeof camera!=='undefined') camera.position.set(me.x,me.y+me.height,me.z);
        if(typeof socket!=='undefined') socket.emit('move',{x:me.x,y:me.y,z:me.z,yaw:me.yaw});
      }
    }catch(e){console.warn('Movement fix:',e);}
  }
  setInterval(sync,16);
})();
