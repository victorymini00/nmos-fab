import * as THREE from 'three';
import { addSignalTower } from './visuals.js';
// Replace this factory with a loaded model later; footprints still come from JSON.
export function createEquipment(spec) {
  const group = new THREE.Group();
  const [w,h,d] = spec.size;
  const box = (size, color, position) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshLambertMaterial({color}));
    mesh.position.set(...position); group.add(mesh); return mesh;
  };
  box([w,h,d],spec.color,[0,h/2,0]);
  box([w*1.01,.16,d*1.01],0x25434b,[0,.16,0]);
  box([w*.52,h*.42,.035],0x173e48,[-w*.13,h*.65,d/2+.025]);
  box([w*.29,.055,.045],0x61daca,[-w*.17,h*.7,d/2+.052]);
  box([w*.2,.04,.045],0x93b8be,[-w*.21,h*.57,d/2+.052]);
  box([.15,.15,.07],0x69d6b3,[w*.32,h*.69,d/2+.04]);
  box([w*.75,.1,d*.7],0xa4bfc1,[0,h+.05,0]);
  group.userData.lamps = addSignalTower(group, spec);
  group.userData.id = spec.id;
  group.position.set(spec.position[0],0,spec.position[1]);
  return group;
}
