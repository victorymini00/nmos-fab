import {test} from 'node:test';
import assert from 'node:assert/strict';
import layout from '../src/data/map_layout.json' with {type:'json'};
import {boundsFor,isFree,slide,distanceToBox} from '../src/world/collision.js';
import {findPath} from '../src/world/navigation.js';
import {WORLD} from '../src/constants.js';
const boxes=layout.equipment.map(e=>boundsFor(e)),r=WORLD.playerHalfSize;
test('map has eight uniquely named valid equipment footprints and a free spawn',()=>{
  assert.equal(layout.equipment.length,8);
  assert.equal(new Set(layout.equipment.map(e=>e.id)).size,8);
  assert.ok(isFree(...layout.spawn,layout.room,boxes,r));
  for(const e of layout.equipment){assert.ok(layout.zones.some(z=>z.id===e.zoneId));const b=boundsFor(e);assert.ok(b.minX> -15&&b.maxX<15&&b.minZ> -11&&b.maxZ<11);}
});
test('AABB blocks equipment and all room edges while allowing sliding',()=>{
  assert.equal(isFree(-10,-7,layout.room,boxes,r),false);
  for(const p of [[15,0],[-15,0],[0,11],[0,-11]])assert.equal(isFree(...p,layout.room,boxes,r),false);
  const b=boxes[0],start={x:b.minX-r-.01,z:-7};
  const result=slide(start,.1,.1,layout.room,boxes,r);
  assert.equal(result.x,start.x);assert.ok(result.z>start.z);
});
test('tap paths reach every equipment interaction area without crossing a box',()=>{
  const start={x:layout.spawn[0],z:layout.spawn[1]};
  for(const e of layout.equipment){
    const target={x:e.position[0],z:e.position[1]+e.size[2]/2+.85};
    const path=findPath(start,target,layout.room,boxes,r);
    assert.ok(path.length>0,e.id);assert.deepEqual(path.at(-1),target);
    let prev=start;
    for(const p of path){for(let i=0;i<=20;i++){const t=i/20;assert.ok(isFree(prev.x+(p.x-prev.x)*t,prev.z+(p.z-prev.z)*t,layout.room,boxes,r),e.id);}prev=p;}
    assert.ok(distanceToBox(target.x,target.z,boundsFor(e))<WORLD.interactionRange);
  }
});
test('invalid tap destinations are rejected',()=>{
  for(const target of [{x:-10,z:-7},{x:40,z:0}])assert.deepEqual(findPath({x:-10,z:7},target,layout.room,boxes,r),[]);
});
test('tap routes connect safely from positions near a machine edge',()=>{
  const b=boxes[0],start={x:b.minX-r-.001,z:-7.13},target={x:0,z:0};
  const path=findPath(start,target,layout.room,boxes,r);assert.ok(path.length);
  let prev=start;
  for(const next of path){for(let i=0;i<=30;i++){const t=i/30;assert.ok(isFree(prev.x+(next.x-prev.x)*t,prev.z+(next.z-prev.z)*t,layout.room,boxes,r));}prev=next;}
});
