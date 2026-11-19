// Pure XZ AABB collision, independent of Three.js and process logic.
export function boundsFor(e, padding = 0) {
  return { minX: e.position[0] - e.size[0]/2 - padding, maxX: e.position[0] + e.size[0]/2 + padding, minZ: e.position[1] - e.size[2]/2 - padding, maxZ: e.position[1] + e.size[2]/2 + padding };
}
export function isFree(x,z,room,boxes,radius) {
  return Math.abs(x) <= room.width/2-radius && Math.abs(z) <= room.depth/2-radius && !boxes.some(b => x > b.minX-radius && x < b.maxX+radius && z > b.minZ-radius && z < b.maxZ+radius);
}
export function slide(position, dx, dz, room, boxes, radius) {
  let {x,z} = position;
  if(isFree(x+dx,z,room,boxes,radius)) x += dx;
  if(isFree(x,z+dz,room,boxes,radius)) z += dz;
  return {x,z};
}
export function distanceToBox(x,z,b) {
  return Math.hypot(Math.max(b.minX-x,0,x-b.maxX),Math.max(b.minZ-z,0,z-b.maxZ));
}
