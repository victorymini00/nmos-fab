import * as THREE from 'three';
import { WORLD, VISUALS } from '../constants.js';
import { addZoneDecals, addPhotoLighting, updateSignalTower, createGuideArrows } from './visuals.js';
import { createPerfMonitor } from './perf.js';
import { createEquipment } from './equipment.js';
import { createCharacter } from './character.js';
import { boundsFor, distanceToBox, slide, isFree } from './collision.js';
import { findPath } from './navigation.js';

export function createWorld(container, layout, {onNearby,onFrame,onMessage}) {
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#bdd2d6');
  // ?quality=low 이면 처음부터 단순화 모드로 시작합니다.
  let lowQuality=new URLSearchParams(location.search).get('quality')==='low';
  const renderer=new THREE.WebGLRenderer({antialias:!lowQuality,alpha:false});
  renderer.setPixelRatio(lowQuality?1:Math.min(devicePixelRatio,WORLD.pixelRatioCap));
  container.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','3D 클린룸. WASD 또는 방향키로 이동하고 E키로 장비를 엽니다.');
  const camera=new THREE.OrthographicCamera(-10,10,10,-10,.1,120);
  scene.add(new THREE.HemisphereLight(0xffffff,0x749496,2.1));
  const light=new THREE.DirectionalLight(0xffffff,2.4);light.position.set(-10,20,10);scene.add(light);
  const mesh=(geometry,color,x,y,z)=>{const m=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color}));m.position.set(x,y,z);scene.add(m);return m;};
  const {width,depth,wallHeight}=layout.room;
  const floor=mesh(new THREE.PlaneGeometry(width,depth),0xdce7e8,0,0,0);floor.rotation.x=-Math.PI/2;
  const grid=new THREE.GridHelper(Math.max(width,depth),Math.max(width,depth),0xa9c0c4,0xc3d4d6);grid.position.y=.006;scene.add(grid);
  // Rear walls full-height; front walls low to keep the fixed camera view readable.
  mesh(new THREE.BoxGeometry(width,wallHeight,.25),0xe8eff0,0,wallHeight/2,-depth/2);
  mesh(new THREE.BoxGeometry(.25,wallHeight,depth),0xd2e0e3,-width/2,wallHeight/2,0);
  mesh(new THREE.BoxGeometry(width,.35,.25),0xa4bfc5,0,.175,depth/2);
  mesh(new THREE.BoxGeometry(.25,.35,depth),0xa4bfc5,width/2,.175,0);
  for(const zone of layout.zones){const p=mesh(new THREE.PlaneGeometry(...zone.size),zone.color,zone.position[0],.012,zone.position[1]);p.rotation.x=-Math.PI/2;}
  addZoneDecals(scene,layout);
  const equipmentRoots=layout.equipment.map(createEquipment);
  for(const model of equipmentRoots)scene.add(model);
  const photoLighting=addPhotoLighting(scene,layout.zones.find(z=>z.id==='photo'),layout.room);
  const statuses={},pulses={};
  const arrows=createGuideArrows(scene);
  const perf=createPerfMonitor({warmup:VISUALS.perfWarmupSeconds,limit:VISUALS.perfFrameLimitSeconds,hold:VISUALS.perfHoldSeconds,smoothing:VISUALS.perfSmoothing});
  let frameCount=0;
  // 단순화: 픽셀 비율 1, 바닥 격자와 Photo 포인트 조명 끔(노란 발광 재질은 유지).
  function simplify(reason){lowQuality=true;renderer.setPixelRatio(1);grid.visible=false;if(photoLighting)photoLighting.lamp.visible=false;resize();if(reason)onMessage(reason);}
  const boxes=layout.equipment.map(e=>boundsFor(e));
  const player=createCharacter();player.position.set(layout.spawn[0],0,layout.spawn[1]);scene.add(player);
  const marker=new THREE.Mesh(new THREE.RingGeometry(.3,.4,24),new THREE.MeshBasicMaterial({color:0x078d86,side:THREE.DoubleSide}));marker.rotation.x=-Math.PI/2;marker.position.y=.04;marker.visible=false;scene.add(marker);
  const highlight=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x0fa797,transparent:true,opacity:.22,depthWrite:false}));highlight.rotation.x=-Math.PI/2;highlight.position.y=.03;highlight.visible=false;scene.add(highlight);
  const guidance=new THREE.Mesh(new THREE.RingGeometry(1,1.12,32),new THREE.MeshBasicMaterial({color:0x008d83,side:THREE.DoubleSide}));
  guidance.rotation.x=-Math.PI/2;guidance.position.y=.035;guidance.visible=false;scene.add(guidance);
  let paused=false,path=[],nearby=null,last=performance.now(),disposed=false;
  const keys=new Set(),ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const keydown=e=>{if(paused||e.target.matches('input,select,textarea'))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();keys.add(e.code);path=[];marker.visible=false;}};
  const clear=()=>keys.clear();
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(paused||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>12)return;
    down=null;const rect=renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(pointer,camera);
    const hits=ray.intersectObjects([floor,...equipmentRoots],true);
    if(!hits.length||hits[0].object!==floor){onMessage('장비가 없는 바닥을 클릭해 주세요.');return;}
    const p=hits[0].point;
    path=findPath(player.position,{x:p.x,z:p.z},layout.room,boxes,WORLD.playerHalfSize);
    marker.visible=path.length>0;
    if(marker.visible)marker.position.set(p.x,.04,p.z);else onMessage('이 위치로 이동할 수 없습니다.');
  });
  // Raycast floor separately: zone decals/grid must not hide the walkable floor.
  floor.userData.walkable=true;
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight,span=WORLD.cameraSpan;
    camera.left=-span*w/h/2;camera.right=span*w/h/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();renderer.setSize(w,h);};
  window.addEventListener('resize',resize);resize();
  if(lowQuality)simplify(null);
  function frame(now){if(disposed)return;const rawDt=(now-last)/1000,dt=Math.min(rawDt,WORLD.maxDelta);last=now;frameCount++;
    if(!paused&&!lowQuality&&perf.sample(rawDt))simplify('프레임 저하가 감지되어 그래픽을 단순화했습니다.');
    let dx=0,dz=0;
    if(!paused){
      const horizontal=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
      const vertical=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
      // Screen-relative movement under the fixed isometric camera.
      dx=(horizontal-vertical)*Math.SQRT1_2;dz=(-horizontal-vertical)*Math.SQRT1_2;
      if(!horizontal&&!vertical&&path.length){const next=path[0];dx=next.x-player.position.x;dz=next.z-player.position.z;const dist=Math.hypot(dx,dz);if(dist<.07){path.shift();dx=dz=0;}else{const s=Math.min(1,dist/(WORLD.speed*dt||1));dx=dx/dist*s;dz=dz/dist*s;}}
      const length=Math.hypot(dx,dz);if(length>1){dx/=length;dz/=length;}
      if(dx||dz){const p=slide(player.position,dx*WORLD.speed*dt,dz*WORLD.speed*dt,layout.room,boxes,WORLD.playerHalfSize);player.position.x=p.x;player.position.z=p.z;player.rotation.y=Math.atan2(dx,dz);}
      if(!path.length)marker.visible=false;
    }
    const target=player.position;
    camera.position.set(target.x+14,18,target.z+14);camera.lookAt(target.x,0,target.z);
    let best=null,bestDist=WORLD.interactionRange;
    layout.equipment.forEach((e,i)=>{const distance=distanceToBox(target.x,target.z,boxes[i]);if(distance<bestDist){best=e;bestDist=distance;}});
    if(best?.id!==nearby?.id){nearby=best;onNearby(best);}
    highlight.visible=!!best;
    if(best){highlight.scale.set(best.size[0]+.55,best.size[2]+.55,1);highlight.position.set(best.position[0],.03,best.position[1]);}
    const t=now/1000;
    for(const root of equipmentRoots){const id=root.userData.id;if(pulses[id]>0)pulses[id]-=dt;updateSignalTower(root.userData.lamps,statuses[id]??'idle',t,pulses[id]??0);}
    arrows.update(t,target);
    // 패널이 열려 있으면 화면이 가려지므로 렌더링 빈도를 낮춥니다.
    if(!paused||frameCount%VISUALS.pausedRenderEvery===0)renderer.render(scene,camera);
    onFrame({camera,player:target,nearby});requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {
    setGuidance(id){const e=layout.equipment.find(e=>e.id===id);guidance.visible=!!e;arrows.set(e??null);if(e)guidance.position.set(e.position[0],.035,e.position[1]+e.size[2]/2+.85);},
    setEquipmentStatus(map){for(const k of Object.keys(statuses))delete statuses[k];Object.assign(statuses,map);},
    pulse(id){pulses[id]=VISUALS.pulseSeconds;},
    get lowQuality(){return lowQuality;},
    walkTo(id){if(paused)return;const e=layout.equipment.find(e=>e.id===id);if(!e)return;const target={x:e.position[0],z:e.position[1]+e.size[2]/2+.85};path=findPath(player.position,target,layout.room,boxes,WORLD.playerHalfSize);marker.visible=!!path.length;if(path.length)marker.position.set(target.x,.04,target.z);else onMessage('이 장비까지 이동 경로를 찾지 못했습니다.');},
    setPaused(value){paused=value;keys.clear();path=[];marker.visible=false;},getNearby:()=>nearby,reset(){player.position.set(...[layout.spawn[0],0,layout.spawn[1]]);path=[];keys.clear();},isFree:(x,z)=>isFree(x,z,layout.room,boxes,WORLD.playerHalfSize)};
}
