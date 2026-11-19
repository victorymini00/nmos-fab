import { isFree } from './collision.js';
// Small uniform grid, generated from JSON footprints. No physics/navigation engine.
export function findPath(start, target, room, boxes, radius) {
  const step=.5, w=Math.round(room.width/step), d=Math.round(room.depth/step);
  const cell=p=>[Math.round((p.x+room.width/2)/step),Math.round((p.z+room.depth/2)/step)];
  const point=([x,z])=>({x:x*step-room.width/2,z:z*step-room.depth/2});
  const key=([x,z])=>`${x},${z}`;
  if(!isFree(target.x,target.z,room,boxes,radius)) return [];
  const lineFree=(from,to)=>{
    const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.05));
    for(let i=0;i<=steps;i++){const t=i/steps;if(!isFree(from.x+(to.x-from.x)*t,from.z+(to.z-from.z)*t,room,boxes,radius))return false;}
    return true;
  };
  const connect=p=>{
    const c=cell(p),candidates=[];
    for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++){
      const n=[c[0]+x,c[1]+z],q=point(n);
      if(isFree(q.x,q.z,room,boxes,radius+.03)&&lineFree(p,q))candidates.push(n);
    }
    return candidates.sort((a,b)=>Math.hypot(point(a).x-p.x,point(a).z-p.z)-Math.hypot(point(b).x-p.x,point(b).z-p.z))[0];
  };
  const a=connect(start),b=connect(target);
  if(!a||!b)return [];
  const queue=[a], parents=new Map([[key(a),null]]);
  let end=null;
  for(let i=0;i<queue.length;i++) {
    const c=queue[i];
    if(key(c)===key(b)){end=c;break;}
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const n=[c[0]+dx,c[1]+dz], p=point(n);
      if(n[0]<0||n[0]>w||n[1]<0||n[1]>d||parents.has(key(n))||!isFree(p.x,p.z,room,boxes,radius+.03))continue;
      parents.set(key(n),c); queue.push(n);
    }
  }
  if(!end)return [];
  const result=[target];
  while(parents.get(key(end))){result.push(point(end));end=parents.get(key(end));}
  // Include the snapped start so the first segment cannot cut an obstacle corner.
  result.push(point(a));
  return result.reverse();
}
