import {currentTask,latestRecord,nextEquipment} from './runsheet.js';
// 장비 신호등 상태(3D 표시용 순수 함수).
// idle: 대기 / next: 다음 목적지 / running: 웨이퍼 처리 후 계측·서명 대기 / fault: 검사 불합격 대기
export function equipmentStatuses(state,flow,ids){
  const out=Object.fromEntries(ids.map(id=>[id,'idle']));
  if(!currentTask(state,flow))return out;
  const r=latestRecord(state,flow),next=nextEquipment(state,flow);
  if(r&&!r.signature&&!r.autoCompleted&&r.equipmentId in out)out[r.equipmentId]=r.measurement&&r.measurement.pass===false?'fault':'running';
  if(next&&out[next]==='idle')out[next]='next';
  return out;
}
