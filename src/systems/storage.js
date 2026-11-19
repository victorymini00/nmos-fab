import {STORAGE} from '../constants.js';
import {applyAction,createLot} from './runsheet.js';
// Persist/replay commands to validate loaded states with exactly the same gates as live actions.
// The storage provider is injected; this module does not depend on DOM, Three.js or localStorage.
export function createPersistence(getStorage,flow){
  let events=[];
  return {
    load(){
      try{
        const raw=getStorage().getItem(STORAGE.key);if(!raw)return {state:createLot(),notice:null};
        const saved=JSON.parse(raw);
        if(saved.version!==STORAGE.version||!Array.isArray(saved.events)||saved.events.length>2000)throw new Error('invalid save');
        let state=createLot();
        for(const event of saved.events){if(typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at)))throw new Error('invalid date');state=applyAction(state,flow,event.action,event.at);}
        events=saved.events;return {state,notice:null};
      }catch{events=[];return {state:createLot(),notice:'저장 데이터를 불러오지 못해 새 Lot으로 시작합니다. 게임은 계속할 수 있습니다.'};}
    },
    record(action,at){events.push({action:structuredClone(action),at});return this.save();},
    save(){try{getStorage().setItem(STORAGE.key,JSON.stringify({version:STORAGE.version,events}));return true;}catch{return false;}},
    reset(){events=[];return this.save();}
  };
}
