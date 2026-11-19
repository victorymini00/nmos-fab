import {INCIDENT as I,METROLOGY as M} from '../constants.js';
import * as Q2 from './incident002.js';
const is001=inc=>inc?.id==='INCIDENT-001';
// INCIDENT 001: "누가 산화막을 망쳤을까?"
// 숨은 원인(cause)은 Lot 첫 기록 시각으로 정해지는 시드에서 고릅니다(저장 재생 시 동일).
// 원인은 장비 상태로만 결과에 반영되고, 플레이어는 측정·로그·기준 시료로 구분해야 합니다.
export const CAUSES={
  bias:{label:'계측기 편향',detail:'두께 측정 장비가 실제보다 두껍게 읽고 있음'},
  overrun:{label:'산화로 과성장',detail:'산화로가 레시피보다 오래 가동돼 실제로 두껍게 자람'},
  local:{label:'국부 두께 이상',detail:'웨이퍼 일부 위치만 두껍게 자람'}
};
export const DISPOSITIONS={
  remeasure:'계측 장비 교정 후 재측정',
  'use-as-is':'MRB 특채: 현재 두께로 다음 공정 진행',
  scrap:'Lot 폐기 후 새 Lot 시작'
};
// 원인별로 적절한 조치. 과성장·국부 이상은 Field 산화막이 두꺼워진 것이라 소자 분리에 큰 문제가 없어 특채가 최선.
const BEST={bias:['remeasure'],overrun:['use-as-is'],local:['use-as-is']},ACCEPTABLE={overrun:['scrap'],local:['scrap']};
const FIELD='field-oxidation';
function hash(text){let h=2166136261>>>0;for(const c of text){h^=c.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h;}
export function startIncident(state,action,now){
  if(state.incident)throw new Error('이 Lot에서는 이미 퀘스트가 진행 중입니다.');
  if(state.records.some(r=>r.operationId===FIELD))throw new Error('Field 산화 전에만 퀘스트를 시작할 수 있습니다. 새 Lot에서 시작하세요.');
  const mode=action.mode==='no-ai'?'no-ai':'ai',participant=String(action.participant??'').trim().slice(0,20);
  if(action.quest==='002')return Q2.start(state,action,now,{mode,participant});
  const keys=Object.keys(CAUSES),cause=keys.includes(action.cause)?action.cause:keys[hash(`${state.lotId}|${now}`)%keys.length];
  state.incident={id:'INCIDENT-001',title:'누가 산화막을 망쳤을까?',mode,participant,cause,phase:'armed',faultApplied:false,startedAt:now,evidence:[],minutes:0,alarm:null,diagnosis:null,disposition:null,evaluation:null};
}
// Field 산화 첫 실행 시 장비 고장을 결과에 반영합니다. growth(minutes)는 산화 모델 호출 함수.
export function applyOxidationFault(state,op,input,growth){
  const inc=state.incident;
  if(!is001(inc)||inc.faultApplied||op.id!==FIELD)return growth(input.timeMinutes);
  inc.faultApplied=true;
  // 캠페인 예방 정비로 타이머를 고친 경우: 고장이 웨이퍼에 닿지 않음
  if(inc.preventedBy){inc.phase='prevented';return growth(input.timeMinutes);}
  if(inc.cause==='overrun'){const actual=input.timeMinutes*I.overrunFactor,result=growth(actual);return {...result,hidden:{actualMinutes:actual}};}
  const result=growth(input.timeMinutes);
  if(inc.cause==='local')return {...result,siteFactors:M.oxideSiteFactors.map((f,i)=>['중앙','북','동','남','서'][i]===I.localSite?I.localFactor:f)};
  if(inc.cause==='bias')state.metrology.biasNm+=I.biasFraction*result.thicknessNm;
  return result;
}
// Field 산화 측정 직후: 평균 또는 지점별 값이 허용 범위를 벗어나면 OOS 경고.
export function afterMeasurement(state,op,measurement){
  const inc=state.incident;if(!is001(inc)||op.id!==FIELD||!inc.faultApplied)return;
  const tol=op.thicknessToleranceFraction,t=measurement.targetNm;
  const outSites=measurement.observed.filter(o=>Math.abs(o.valueNm-t)/t>tol).map(o=>o.name);
  measurement.outOfSpecSites=outSites;
  if(outSites.length)measurement.pass=false;
  if(inc.phase==='armed'&&(outSites.length||!measurement.pass)){inc.phase='alarm';inc.alarm={meanNm:measurement.meanNm,outSites,targetNm:t,at:measurement.measuredAt};}
  else if(inc.phase==='hold'&&measurement.observed.length===5)addEvidence(inc,'map',measurement.minutes);
}
function addEvidence(inc,kind,minutes){if(!inc.evidence.includes(kind))inc.evidence.push(kind);inc.minutes+=minutes;}
export function holdLot(state){const inc=state.incident;if(inc?.phase!=='alarm')throw new Error('HOLD할 경고가 없습니다.');inc.phase='hold';}
export function onReferenceCheck(state,result){const inc=state.incident;if(is001(inc)&&inc.phase==='hold')addEvidence(inc,'reference',result.minutes);}
export function inspectLog(state,fieldRecord){
  const inc=state.incident;if(!is001(inc))throw new Error('이 퀘스트에서는 산화로 로그를 조사하지 않습니다.');if(inc.phase!=='hold')throw new Error('Lot을 HOLD한 뒤 조사할 수 있습니다.');
  if(!fieldRecord)throw new Error('조회할 산화 공정 기록이 없습니다.');
  const recipe=fieldRecord.input.timeMinutes,actual=fieldRecord.result.hidden?.actualMinutes??recipe;
  addEvidence(inc,'log',I.logMinutes);
  return {kind:'incident-log',recipeMinutes:recipe,actualMinutes:actual,temperatureC:fieldRecord.input.temperatureC,ambient:fieldRecord.input.ambient,minutes:I.logMinutes,
    note:actual>recipe+1e-9?`산화 단계 타이머 이상: 레시피 ${recipe}분, 실제 가동 ${actual.toFixed(0)}분`:'온도·가스·시간 로그 모두 레시피와 일치'};
}
export function diagnose(state,action,now){
  if(state.incident?.id===Q2.ID)return Q2.diagnose(state,action,now);
  const inc=state.incident;if(inc?.phase!=='hold')throw new Error('Lot을 HOLD하고 증거를 확인한 뒤 판정하세요.');
  if(!CAUSES[action.cause])throw new Error('원인을 선택하세요.');if(!DISPOSITIONS[action.disposition])throw new Error('조치를 선택하세요.');
  inc.diagnosis=action.cause;inc.disposition=action.disposition;inc.phase='resolved';inc.resolvedAt=now;
  const causeOk=action.cause===inc.cause,best=BEST[inc.cause].includes(action.disposition),ok=best||ACCEPTABLE[inc.cause]?.includes(action.disposition);
  const needed={bias:'reference',overrun:'log',local:'map'}[inc.cause];
  const evidenceScore=inc.evidence.includes(needed)?I.evidencePoints:0;
  const minutePenalty=Math.max(0,inc.minutes-I.freeInvestigationMinutes)*I.minutePenalty;
  const score=Math.max(0,Math.round((causeOk?I.causePoints:0)+(best?I.dispositionPoints:ok?I.dispositionPoints/2:0)+evidenceScore-minutePenalty));
  inc.evaluation={meetings:inc.meetings?.length??0,aiMeetings:(inc.meetings??[]).filter(m=>m.source==='ai').length,causeOk,dispositionOk:ok,bestDisposition:best,keyEvidence:needed,keyEvidenceFound:evidenceScore>0,minutes:inc.minutes,score};
}
export function changeDisposition(state,disposition){if(state.incident?.id===Q2.ID)return Q2.changeDisposition(state,disposition);const inc=state.incident;if(inc?.phase!=='resolved')throw new Error('먼저 원인을 판정하세요.');if(!DISPOSITIONS[disposition])throw new Error('조치를 선택하세요.');inc.disposition=disposition;}
// 서명 규칙: 경고 상태에서는 서명 불가, 특채 판정이면 불합격이어도 결함 인지 서명 가능.
export function signGate(state,op,record,action){
  Q2.signGate(state,op,action);
  const inc=state.incident;if(!is001(inc)||op.id!==FIELD)return null;
  if(inc.phase==='alarm'||inc.phase==='hold')throw new Error('OOS 경고 중입니다. Lot을 HOLD하고 원인을 판정한 뒤 진행하세요.');
  if(inc.phase==='armed'&&inc.faultApplied){inc.phase='missed';return null;}
  if(inc.phase==='resolved'&&inc.disposition==='use-as-is'&&record.measurement&&!record.measurement.pass){
    if(action.acknowledgeDefects!==true)throw new Error('특채 진행을 확인하는 체크가 필요합니다.');return 'override';}
  if(inc.phase==='resolved'&&inc.disposition==='scrap')throw new Error('Lot 폐기로 판정했습니다. 새 Lot을 시작하세요.');
  return null;
}
export const EVIDENCE_LABELS={reference:'기준 시료 측정',log:'산화로 공정 로그',map:'5점 두께 재측정'};
