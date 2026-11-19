import { OXIDATION as C, STORAGE,PHOTO as P,ETCH as E,PATTERN_ETCH as PE } from '../constants.js';
import { growOxide } from './physics.js';
import {coatResist,alignmentResult,developResist,etchOxide} from './lithography.js';
import {depositFilm,implantPhosphorus,annealImplant,etchPattern} from './fabrication.js';
import {buildReferenceLot,testElectrical} from './electrical.js';
export function createLot(){return {version:STORAGE.version,lotId:'NMOS-001',cursor:0,oxideNm:C.initialOxideNm,activeOxideNm:C.initialOxideNm,fieldOxideNm:C.initialOxideNm,gateOxideNm:null,screenOxideNm:null,films:{},geometry:{},patterns:{},implant:null,anneal:null,contacts:null,electrical:null,prNm:0,photo:null,etch:null,penaltyPoints:0,reworkCount:0,cleaned:false,records:[],nextRecord:1};}
export function operations(flow){return flow.stages.flatMap(stage=>stage.operations.map(operation=>({stage,operation})));}
export function currentTask(state,flow){return operations(flow)[state.cursor]??null;}
export function latestRecord(state,flow){const task=currentTask(state,flow);return task?[...state.records].reverse().find(r=>r.operationId===task.operation.id&&!r.superseded)??null:null;}
export function targetThickness(operation){const values=Object.fromEntries(operation.parameters.map(p=>[p.key,p.target]));return growOxide({...values,initialOxideNm:operation.modelId==='gate-oxide'?0:C.initialOxideNm}).thicknessNm;}
export function nextEquipment(state,flow){const task=currentTask(state,flow);if(!task)return null;const r=latestRecord(state,flow);if(r?.measurement&&!r.measurement.pass&&!task.operation.acceptDefects)return task.operation.equipmentId;return r&&task.operation.measurementRequired?task.operation.measurementEquipmentId:task.operation.equipmentId;}
export function recommendedEtchMinutes(state){return (state.photo?.referenceOxideNm??state.fieldOxideNm)/E.oxideRateNmPerMinute*(1+E.overetchFraction);}
export function recommendedPatternEtchMinutes(state,op){return Math.max(.01,(state.photo?.referenceFilmMaxNm??0)/PE[op.material].rate*(1+PE.overetchFraction)-(state.etch?.totalMinutes??0));}
export function canRestartPhoto(state,flow){const t=currentTask(state,flow);return !!(t&&state.photo&&!state.etch&&t.stage.number>=2&&(!t.operation.photoGroup||t.operation.photoGroup===state.photo.group));}
export function evaluateMeasurement(value,operation,input){const target=targetThickness(operation),deviation=(value-target)/target;return {targetNm:target,deviation,pass:Math.abs(deviation)<=operation.thicknessToleranceFraction&&input.ambient===operation.parameters.find(p=>p.key==='ambient').target};}
export function applyAction(previous,flow,action,now=new Date().toISOString()) {
  const state=structuredClone(previous),task=currentTask(state,flow);
  if(!task)throw new Error('전기적 테스트와 최종 확인 서명을 완료했습니다.');
  const {stage,operation:op}=task;
  const record=latestRecord(state,flow);
  if(action.type==='restart-photo'){
    if(action.equipmentId!=='coater'||!canRestartPhoto(state,flow))throw new Error('현재 마스크의 식각 전 코터에서만 포토를 재작업할 수 있습니다.');
    const group=state.photo.group;
    for(const r of state.records)if(r.photoGroup===group)r.superseded=true;
    state.photo=null;state.prNm=0;state.reworkCount++;state.penaltyPoints+=P.reworkPenalty;
    state.cursor=operations(flow).findIndex(t=>t.operation.modelId==='hmds'&&t.operation.photoGroup===group);
    state.records.push({id:state.nextRecord++,stageNumber:stage.number,stageTitle:'포토 재작업',operationId:'photo-rework',equipmentId:'coater',input:{action:`${group} PR 제거 후 재작업`},result:{penaltyPoints:P.reworkPenalty},executedAt:now,measurement:null,signature:null,rework:true,superseded:false});
  }else if(action.type==='execute'){
    if(action.equipmentId!==op.equipmentId)throw new Error('현재 공정에 지정된 장비를 사용하세요.');
    if(record&&!op.measurementRequired)throw new Error('이미 실행했습니다. 확인 서명을 완료하세요.');
    if(record&&!record.measurement)throw new Error('이전 공정 결과를 먼저 측정한 뒤 재작업하세요.');
    if(record&&!['deal-grove','boe','gate-oxide','deposit','pattern-etch'].includes(op.modelId))throw new Error('중복 실행할 수 없습니다. 포토 공정은 코터에서 재작업을 시작하세요.');
    for(const p of op.parameters){const value=action.input?.[p.key];if(p.options?!p.options.includes(value):(!Number.isFinite(value)||value<p.min||value>p.max))throw new Error(`${p.label} 입력 범위를 확인하세요.`);}
    let input={},result={cleaned:true};
    if(op.modelId==='deal-grove'){
      if(!state.cleaned)throw new Error('RCA 세정과 확인 서명을 먼저 완료하세요.');
      input={temperatureC:action.input?.temperatureC,timeMinutes:action.input?.timeMinutes,ambient:action.input?.ambient};
      result=growOxide({...input,initialOxideNm:state.oxideNm});state.oxideNm=result.thicknessNm;state.activeOxideNm=state.fieldOxideNm=state.oxideNm;
    }else if(op.modelId==='rca-check'){state.cleaned=true;}
    else if(op.modelId==='strip'){
      state.prNm=0;state.photo=null;state.etch=null;result={kind:'strip',prNm:0,pass:true};
    }else if(op.modelId==='gate-oxide'){
      if(state.prNm>0)throw new Error('게이트 산화 전에 PR을 제거하세요.');
      input=Object.fromEntries(op.parameters.map(p=>[p.key,action.input[p.key]]));
      result={...growOxide({...input,initialOxideNm:state.activeOxideNm}),kind:'gate-oxide'};
      state.gateOxideNm=state.activeOxideNm=result.thicknessNm;state.screenOxideNm=result.thicknessNm;
      state.fieldOxideNm=growOxide({...input,initialOxideNm:state.fieldOxideNm}).thicknessNm;state.oxideNm=state.fieldOxideNm;
      result.targetNm=targetThickness(op);result.pass=Math.abs(result.thicknessNm-result.targetNm)/result.targetNm<=op.thicknessToleranceFraction&&input.ambient==='dry';
    }else if(op.modelId==='electrical'){
      input=structuredClone(op.testConditions);
      const reference=buildReferenceLot(flow,createLot(),applyAction);
      result=testElectrical(state,reference,input,op.specification);state.electrical=result;
    }else if(op.modelId==='deposit'){
      if(state.prNm>0)throw new Error('증착 전에 PR을 제거하세요.');
      input=Object.fromEntries(op.parameters.map(p=>[p.key,action.input[p.key]]));
      result=depositFilm(op.material,input,state.films[op.material]?.values,op.targetThicknessNm);
      if(op.material==='metal'){
        result.contactReady=state.contacts?.pass===true;result.pass&&=result.contactReady;
      }
      state.films[op.material]=structuredClone(result);
      state.geometry[op.material]={openValues:[...result.values],protectedValues:[...result.values],defectValues:[...result.values]};
    }else if(op.modelId==='implant'){
      if(!state.patterns.gate||!state.films.poly)throw new Error('Gate 패터닝을 먼저 완료하세요.');
      input=Object.fromEntries(op.parameters.map(p=>[p.key,action.input[p.key]]));
      result=implantPhosphorus(input,state.screenOxideNm??state.activeOxideNm,Math.min(...state.geometry.poly.protectedValues));
      result.gateMaskPass&&=state.patterns.gate.pass;result.pass&&=result.gateMaskPass;state.implant=result;
    }else if(op.modelId==='anneal'){
      input=Object.fromEntries(op.parameters.map(p=>[p.key,action.input[p.key]]));result=annealImplant(state.implant,input);state.anneal=result;
    }else if(op.modelId==='pattern-etch'){
      if(!state.photo?.developed||state.photo.group!==op.photoGroup)throw new Error('해당 마스크 현상·검사를 먼저 완료하세요.');
      input={minutes:action.input.minutes};let geometry=state.geometry[op.material];
      if(!geometry)throw new Error('식각할 막을 먼저 증착하세요.');
      if(!state.etch&&op.material==='ild')geometry={...geometry,openValues:geometry.openValues.map(v=>v+(state.screenOxideNm??0))};
      result=etchPattern(op.material,input,geometry,state.photo,state.etch);
      state.geometry[op.material]={openValues:result.openValues,protectedValues:result.protectedValues,defectValues:result.defectValues};
      state.etch=result;state.prNm=result.protectedPrNm;state.patterns[op.photoGroup]=structuredClone(result);
      if(op.material==='poly')state.screenOxideNm=Math.max(0,(state.gateOxideNm??0)-result.maxUnderlyingLossNm);
      if(op.material==='ild'){
        state.contacts={...result,pass:result.pass&&state.anneal?.pass===true};
        // Contact targets ILD plus the S/D screen oxide. Keep the channel gate oxide intact.
        state.screenOxideNm=Math.min(state.screenOxideNm??0,result.maxResidualNm);
      }
    }
    else if(op.modelId==='hmds'){
      input={treatment:action.input.treatment};const group=op.photoGroup??'active',material=op.material??'oxide';
      const film=state.films[material],extra=material==='ild'?(state.screenOxideNm??0):0;
      if(material!=='oxide'&&!film)throw new Error('포토 전에 대상 막을 증착하세요.');
      state.etch=null;state.photo={group,material,hmds:input.treatment==='apply',referenceOxideNm:state.fieldOxideNm,referenceFilmMaxNm:(film?.maxNm??state.fieldOxideNm)+extra,referenceFilmMinNm:film?.minNm??state.fieldOxideNm};result={hmds:state.photo.hmds,adhesion:state.photo.hmds?P.hmdsAdhesion:P.skippedAdhesion};
    }else if(op.modelId==='spin'){
      if(!state.photo)throw new Error('HMDS 처리 또는 생략을 기록하세요.');
      input={rpm:action.input.rpm};state.prNm=coatResist(input.rpm);state.photo.prNm=state.prNm;result={prNm:state.prNm,softBakeC:P.softBakeC,softBakeSeconds:P.softBakeSeconds};
    }else if(op.modelId==='exposure'){
      if(!state.photo?.prNm)throw new Error('PR을 먼저 코팅하세요.');
      input=Object.fromEntries(op.parameters.map(p=>[p.key,action.input[p.key]]));const alignment=alignmentResult(input);state.photo.alignment=alignment;state.photo.dose=input.dose;result={...alignment,dose:input.dose};
    }else if(op.modelId==='develop'){
      if(!state.photo?.alignment)throw new Error('정렬과 노광을 먼저 실행하세요.');
      input={seconds:action.input.seconds};result=developResist({prNm:state.photo.prNm,dose:state.photo.dose,seconds:input.seconds,hmds:state.photo.hmds,alignment:state.photo.alignment});state.photo.developed=result;state.prNm=result.protectedPrNm;
    }else if(op.modelId==='boe'){
      if(!state.photo?.developed)throw new Error('현상과 패턴 검사를 먼저 완료하세요.');
      input={minutes:action.input.minutes};const previousEtch=state.etch,dev=state.photo.developed;
      result=etchOxide({activeOxideNm:state.activeOxideNm,fieldOxideNm:state.fieldOxideNm,defectOxideNm:previousEtch?.defectOxideNm??state.fieldOxideNm,openingPrNm:previousEtch?.openingPrNm??dev.openingPrNm,protectedPrNm:previousEtch?.protectedPrNm??dev.protectedPrNm,defectFraction:dev.defectFraction,minutes:input.minutes,totalMinutes:previousEtch?.totalMinutes??0,referenceOxideNm:state.photo.referenceOxideNm});
      result.pass&&=state.photo.alignment.alignmentPass;
      result.overlayUm=state.photo.alignment.overlayUm;
      state.etch=result;state.activeOxideNm=result.activeOxideNm;state.fieldOxideNm=result.fieldOxideNm;state.oxideNm=state.fieldOxideNm;state.prNm=result.protectedPrNm;
      state.patterns.active=structuredClone(result);
    }else throw new Error('지원하지 않는 공정 모델입니다.');
    if(record)record.superseded=true;
    state.records.push({id:state.nextRecord++,stageNumber:stage.number,stageTitle:stage.title,operationId:op.id,photoGroup:op.photoGroup,equipmentId:op.equipmentId,input,result,executedAt:now,measurement:null,signature:null,rework:!!record,autoCompleted:!!op.autoAdvance,superseded:false});
    if(op.modelId==='electrical')state.records.at(-1).measurement={...structuredClone(result),equipmentId:op.equipmentId,measuredAt:now,pass:result.grade!=='F'};
    if(record){state.reworkCount++;state.penaltyPoints+=P.reworkPenalty;}
    if(op.autoAdvance)state.cursor++;
  }else if(action.type==='measure'){
    if(!op.measurementRequired||action.equipmentId!==op.measurementEquipmentId)throw new Error('지정된 두께 측정 장비를 사용하세요.');
    if(!record)throw new Error('산화 공정을 먼저 실행하세요.');
    if(record.measurement)throw new Error('이미 이 공정 결과를 측정했습니다.');
    if(op.measurementType){record.measurement={equipmentId:action.equipmentId,measuredAt:now,kind:op.measurementType,...structuredClone(record.result)};}
    else{const value=Number(record.result.thicknessNm.toFixed(C.measurementDecimals));record.measurement={equipmentId:action.equipmentId,thicknessNm:value,measuredAt:now,...evaluateMeasurement(value,op,record.input)};}
  }else if(action.type==='sign'){
    if(!record)throw new Error('공정을 먼저 실행하세요.');
    const station=op.measurementRequired?op.measurementEquipmentId:op.equipmentId;
    if(action.equipmentId!==station)throw new Error('현재 확인 장비에서 서명하세요.');
    if(op.measurementRequired&&(!record.measurement||(!record.measurement.pass&&!op.acceptDefects)))throw new Error('측정값과 분위기가 목표를 만족해야 확인 서명할 수 있습니다. 산화로에서 재작업하거나 새 Lot을 시작하세요.');
    if(record.measurement&&!record.measurement.pass&&op.acceptDefects&&action.acknowledgeDefects!==true)throw new Error('검사에서 확인된 결함을 인지했다는 체크가 필요합니다.');
    if(op.modelId==='electrical'&&record.result.grade==='F'&&action.acknowledgeDefects!==true)throw new Error('F 등급 결과를 확인했다는 체크가 필요합니다.');
    const name=typeof action.name==='string'?action.name.trim():'';
    if(!name||name.length>32)throw new Error('확인 서명은 1~32자로 입력하세요.');
    record.signature={name,signedAt:now,acknowledgedDefects:!!action.acknowledgeDefects};state.cursor++;
  }else throw new Error('지원하지 않는 동작입니다.');
  return state;
}
