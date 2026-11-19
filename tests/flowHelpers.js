import flow from '../src/data/process_flow.json' with {type:'json'};
import {applyAction,createLot,currentTask,latestRecord,recommendedEtchMinutes,recommendedPatternEtchMinutes} from '../src/systems/runsheet.js';
export function defaultInput(state,op){
  const input=Object.fromEntries(op.parameters.map(p=>[p.key,p.target]));
  if(op.modelId==='boe')input.minutes=recommendedEtchMinutes(state);
  if(op.modelId==='pattern-etch')input.minutes=recommendedPatternEtchMinutes(state,op);
  return input;
}
export function playThrough({untilStage=12,override=()=>null,acknowledge=false,initial=createLot(),maxSteps=250}={}){
  let state=initial;const events=[];
  for(let i=0;i<maxSteps;i++){
    const task=currentTask(state,flow);if(!task||task.stage.number>=untilStage)return {state,events};
    const op=task.operation,r=latestRecord(state,flow);let action;
    if(!r)action={type:'execute',equipmentId:op.equipmentId,input:{...defaultInput(state,op),...override(op,state)}};
    else if(op.measurementRequired&&!r.measurement)action={type:'measure',equipmentId:op.measurementEquipmentId};
    else action={type:'sign',equipmentId:op.measurementRequired?op.measurementEquipmentId:op.equipmentId,name:'QA',acknowledgeDefects:acknowledge};
    events.push(action);state=applyAction(state,flow,action,'2026-11-19T12:00:00Z');
  }throw new Error('Flow did not finish within step bound');
}
