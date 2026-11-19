import * as THREE from 'three';
export function createCharacter() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.29,.66,4,8), new THREE.MeshLambertMaterial({color:0xf7faf9}));
  body.position.y=.64; group.add(body);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.4,.21,.14),new THREE.MeshLambertMaterial({color:0x244959}));
  visor.position.set(0,1.04,.25); group.add(visor);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(.13,.15,.03),new THREE.MeshBasicMaterial({color:0x13a99b}));
  badge.position.set(.13,.64,.29); group.add(badge);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.43,16), new THREE.MeshBasicMaterial({color:0x244e58,transparent:true,opacity:.18,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2; shadow.position.y=.018; group.add(shadow);
  return group;
}
