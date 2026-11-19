import * as THREE from 'three';
import {VISUALS as V} from '../constants.js';

// Bay 바닥 테두리와 바닥 표기. 캔버스 텍스처 1장/Bay, 그림자·후처리 없음.
export function addZoneDecals(scene,layout){
  const texts=[];
  for(const zone of layout.zones){
    const [w,d]=zone.size,[x,z]=zone.position,c=new THREE.Color(zone.color).multiplyScalar(.72);
    const pts=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>new THREE.Vector3(x+a,.02,z+b));
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:c})));
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const ctx=canvas.getContext('2d');
    ctx.font='700 46px "Segoe UI","Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=`#${c.clone().multiplyScalar(.75).getHexString()}`;ctx.globalAlpha=.75;ctx.fillText(zone.name,256,50);
    const tex=new THREE.CanvasTexture(canvas);tex.anisotropy=4;
    const tw=Math.min(w-.6,4.4),th=tw*96/512;
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(tw,th),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
    plane.rotation.x=-Math.PI/2;plane.position.set(x,.025,z+d/2-.35-th/2);scene.add(plane);texts.push(plane);
  }
  return texts;
}

// Photo Bay: 노란 형광등(자외선 차단 조명) 표현. 발광 재질만 사용하고 조명은 기존 포인트 1개.
export function addPhotoLighting(scene,zone,room){
  if(!zone)return null;
  const group=new THREE.Group(),[w,d]=zone.size,[x,z]=zone.position,glow=new THREE.MeshBasicMaterial({color:0xffd34d});
  const wall=new THREE.Mesh(new THREE.BoxGeometry(w,room.wallHeight,.04),new THREE.MeshLambertMaterial({color:0xf3dc8f}));
  wall.position.set(x,room.wallHeight/2,-room.depth/2+.15);group.add(wall);
  const strip=new THREE.Mesh(new THREE.BoxGeometry(w-.4,.16,.06),glow);strip.position.set(x,room.wallHeight-.3,-room.depth/2+.2);group.add(strip);
  for(const dz of [-d/2+.9,-d/2+1.9]){const tube=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,w-1.2,8),glow);tube.rotation.z=Math.PI/2;tube.position.set(x,3,z+dz);group.add(tube);}
  const lamp=new THREE.PointLight(0xffd56a,22,12,2);lamp.position.set(x,4,z);group.add(lamp);
  scene.add(group);return {group,lamp};
}

// 장비 위 신호등 타워 (위에서부터 빨강·주황·초록).
const LAMP={red:[0x4a2a2a,0xff4d3d],amber:[0x4a3f22,0xffb72e],green:[0x24433a,0x3ef0a2]};
export function addSignalTower(root,spec){
  const [w,h,d]=spec.size,group=new THREE.Group();group.position.set(w*.36,h+.1,-d*.3);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.6,6),new THREE.MeshLambertMaterial({color:0x58717a}));pole.position.y=.3;group.add(pole);
  const lamps={};['green','amber','red'].forEach((name,i)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.22,12),new THREE.MeshBasicMaterial({color:LAMP[name][0]}));m.position.y=.72+i*.24;group.add(m);lamps[name]=m;});
  root.add(group);return lamps;
}
function setLamp(lamp,name,level){lamp.material.color.setHex(LAMP[name][0]).lerp(new THREE.Color(LAMP[name][1]),level);}
const blink=(t,hz)=>Math.sin(t*hz*2*Math.PI)>0?1:0;
// status: idle | next | running | fault. pulseLeft>0이면 실행 직후 빠른 점멸.
export function updateSignalTower(lamps,status,t,pulseLeft=0){
  let g=.25,a=0,r=0;
  if(status==='next')g=.6+.4*Math.abs(Math.sin(t*2));
  if(status==='running'){g=0;a=blink(t,V.runningBlinkHz);}
  if(status==='fault'){g=0;r=blink(t,V.faultBlinkHz);}
  if(pulseLeft>0){a=blink(t,V.pulseBlinkHz);g=1-a;r=0;}
  setLamp(lamps.green,'green',g);setLamp(lamps.amber,'amber',a);setLamp(lamps.red,'red',r);
}

// 다음 목적지: 장비 위에서 위아래로 움직이는 화살표 + 캐릭터 발밑 방향 화살표.
export function createGuideArrows(scene){
  const mat=new THREE.MeshBasicMaterial({color:0x06a08f});
  const arrow=new THREE.Group();
  const head=new THREE.Mesh(new THREE.ConeGeometry(.42,.7,16),mat);head.rotation.x=Math.PI;arrow.add(head);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.55,12),mat);shaft.position.y=.6;arrow.add(shaft);
  arrow.visible=false;scene.add(arrow);
  const shape=new THREE.Shape();shape.moveTo(0,.45);shape.lineTo(.32,-.15);shape.lineTo(0,0);shape.lineTo(-.32,-.15);shape.closePath();
  const chevron=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:0x06a08f,transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide}));
  chevron.rotation.x=-Math.PI/2;chevron.visible=false;scene.add(chevron);
  let target=null;
  return {
    set(spec){target=spec?{x:spec.position[0],z:spec.position[1],top:spec.size[1]}:null;arrow.visible=!!target;if(!target)chevron.visible=false;},
    update(t,player){
      if(!target)return;
      arrow.position.set(target.x,target.top+V.arrowLift+Math.sin(t*3)*V.arrowBob,target.z);arrow.rotation.y=t*1.2;
      const dx=target.x-player.x,dz=target.z-player.z,dist=Math.hypot(dx,dz);
      chevron.visible=dist>V.chevronHideDistance;
      if(chevron.visible){chevron.position.set(player.x+dx/dist*.95,.05,player.z+dz/dist*.95);chevron.rotation.z=Math.atan2(dx,-dz)*-1;}
    }
  };
}
