import {INCIDENT2 as Q,ELECTRICAL as E} from '../constants.js';
// INCIDENT 002: "완성된 NMOS가 작동하지 않는다"
// 숨은 원인은 퀘스트 시작 시 시드로 정해 저장합니다(검사 순서·AI 호출과 무관).
// 소자(공정 모델 결과)와 테스트 접촉 상태(프로브)를 분리합니다:
//  - contact-residue / metal-open: 소자 자체가 끊김(물리 결함). 프로브를 다시 대도 열린 채로 남음.
//  - probe-contact: 소자는 정상, 프로브 접촉만 불량. 재접촉하면 측정이 돌아오지만 소자 특성은 변하지 않음.
export const ID='INCIDENT-002';
export const CAUSES={
  'contact-residue':{label:'Contact 식각 잔사',detail:'Contact 구멍 바닥에 절연막이 남아 S/D와 배선이 연결되지 않음'},
  'metal-open':{label:'Metal 배선 단선',detail:'배선이 중간에 끊겨 신호가 전달되지 않음'},
  'probe-contact':{label:'테스트 프로브 접촉 불량',detail:'소자는 정상이나 측정 탐침이 패드에 제대로 닿지 않음'}
};
export const CHECKS={
  history:{label:'공정 이력 검토',detail:'Runsheet의 Contact·Metal 관련 검사 기록을 다시 확인'},
  'contact-chain':{label:'Contact 체인 저항 검사',detail:`테스트 구조의 Contact ${Q.contactChainCount}개 직렬 저항 측정`},
  'metal-continuity':{label:'배선 연속성 검사',detail:'같은 웨이퍼의 배선 패턴 양 끝 저항 측정'},
  'probe-reseat':{label:'프로브 재접촉 후 재측정',detail:'탐침을 들어 올렸다 다시 대고 Id 재측정'}
};
export const DISPOSITIONS={
  'reseat-retest':'프로브 재접촉·테스터 점검 후 재측정',
  'scrap-contact':'Lot 폐기 + Contact 식각 조건·검사 기준 개선',
  'scrap-metal':'Lot 폐기 + Metal 증착·식각 조건 개선',
  'ship-as-is':'추가 조치 없이 결과대로 서명'
};
const BEST={'contact-residue':'scrap-contact','metal-open':'scrap-metal','probe-contact':'reseat-retest'};
const KEY={'contact-residue':'contact-chain','metal-open':'metal-continuity','probe-contact':'probe-reseat'};
function hash(text){let h=2166136261>>>0;for(const c of text){h^=c.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h;}
// 결정적 측정 산포: 같은 검사는 언제 해도 같은 값(검사 순서와 무관)
const jitter=(inc,key)=>1+Q.readNoiseFraction*(((hash(`${inc.startedAt}|${key}`)%2001)/1000)-1);
export function start(state,action,now,base){
  const keys=Object.keys(CAUSES),cause=keys.includes(action.cause)?action.cause:keys[hash(`${state.lotId}|${now}|002`)%keys.length];
  state.incident={...base,id:ID,title:'완성된 NMOS가 작동하지 않는다',cause,phase:'armed',startedAt:now,checks:[],minutes:0,alarm:null,diagnosis:null,disposition:null,
    probeSeated:false,action:null,verification:null,evaluation:null,meetings:[]};
}
export const is002=state=>state.incident?.id===ID;
const deviceOpen=inc=>inc.cause==='contact-residue'||inc.cause==='metal-open';
const probeOpen=inc=>inc.cause==='probe-contact'&&!inc.probeSeated;
// 전기적 테스트 결과에 "측정 계층"을 씌웁니다. 소자 모델 결과(result)는 바꾸지 않고, 단자 측정만 OPEN으로 만듭니다.
export function applyTestLayer(state,result,now){
  const inc=state.incident;if(!inc||inc.id!==ID)return result;
  if(!deviceOpen(inc)&&!probeOpen(inc))return {...result,measurementStatus:'measured'};
  const open={...result,measurementStatus:'open',valid:false,ionA:null,curve:result.curve.map(p=>({vgV:p.vgV,idA:null,intrinsicIdA:null})),
    grade:'F',score:0,inSpec:false,pass:false,feedback:[],openDetected:true,
    limitations:[`단자 전류가 측정 하한(${Q.currentFloorA} A)보다 작아 OPEN으로 판정 · 원인은 추가 검사로 확인해야 함`,...result.limitations]};
  if(inc.phase==='armed'){inc.phase='alarm';inc.alarm={at:now,symptom:'OPEN',conditions:result.conditions};}
  return open;
}
function decisive(inc,kind){const c=inc.checks.find(c=>c.kind===kind);return c?c.result.positive:null;}
// 원인별 확인 상태: confirmed / ruled-out / unverified (공정 이력 검토는 원인을 가르지 못함)
export function causeStatus(inc){
  return Object.fromEntries(Object.keys(CAUSES).map(k=>{const v=decisive(inc,KEY[k]);return [k,v===true?'confirmed':v===false?'ruled-out':'unverified'];}));
}
function runCheck(state,kind){
  const inc=state.incident,m=state.electrical?.parameters;
  if(kind==='history'){
    const find=id=>[...state.records].reverse().find(r=>r.operationId===id&&!r.superseded);
    const line=(id,label)=>{const r=find(id),meas=r?.measurement;return {step:label,inspected:!!meas,pass:meas?.pass??null,maxResidualNm:meas?.maxResidualNm??null,defectPct:meas?.defectFraction!=null?Math.round(meas.defectFraction*1000)/10:null};};
    return {positive:null,lines:[line('contact-etch','Contact 식각 검사'),line('al-deposition','Al 증착 측정'),line('metal-etch','Metal 식각 검사')],
      note:'공정 중 검사는 샘플 위치 기준이에요. 검사 합격이 테스트 소자 위치의 결함 없음을 보장하지는 않아요.'};
  }
  if(kind==='contact-chain'){
    const nominal=Q.contactChainCount*E.contactOhmPerTerminal*jitter(inc,kind),open=inc.cause==='contact-residue';
    return {positive:open,ohm:open?null:Math.round(nominal),reading:open?`> ${Q.openOhm.toExponential(0)} Ω (OPEN)`:`${Math.round(nominal).toLocaleString()} Ω (기준 약 ${(Q.contactChainCount*E.contactOhmPerTerminal).toLocaleString()} Ω)`};
  }
  if(kind==='metal-continuity'){
    const width=E.wireWidthUm,thicknessNm=Math.min(...(state.geometry?.metal?.protectedValues??[500]));
    const nominal=E.alResistivityOhmCm*(Q.serpentineLengthUm/1e4)/((width/1e4)*(thicknessNm/1e7))*jitter(inc,kind),open=inc.cause==='metal-open';
    return {positive:open,ohm:open?null:Math.round(nominal*10)/10,reading:open?`> ${Q.openOhm.toExponential(0)} Ω (OPEN)`:`${(Math.round(nominal*10)/10).toLocaleString()} Ω (배선 두께·폭으로 계산한 예상과 비슷함)`};
  }
  if(kind==='probe-reseat'){
    inc.probeSeated=true;
    const restored=inc.cause==='probe-contact',ion=state.electrical?.reference?.ionA;
    return {positive:restored,reading:restored?`재접촉 후 Id@Vg=${state.electrical?.conditions?.vgMaxV??3.3} V 측정됨 (모델 기반 예상 ${((ion??0)*1000).toFixed(3)} mA와 비슷)`:`재접촉 후에도 측정 하한 미만 (OPEN 유지)`,restoredIdA:restored?ion:null};
  }
  throw new Error('알 수 없는 검사입니다.');
}
export function check(state,kind,now){
  const inc=state.incident;if(!['hold','action'].includes(inc?.phase))throw new Error('Lot을 HOLD한 뒤 검사할 수 있습니다.');
  if(!CHECKS[kind])throw new Error('알 수 없는 검사입니다.');
  const minutes=Q.minutes[kind],confirmedBefore=Object.values(causeStatus(inc)).includes('confirmed'),repeat=inc.checks.some(c=>c.kind===kind);
  const result=runCheck(state,kind);
  inc.checks.push({kind,at:now,minutes,result,afterDiagnosis:inc.phase!=='hold',unnecessary:repeat||confirmedBefore});inc.minutes+=minutes;
  return {kind:'incident2-check',check:kind,label:CHECKS[kind].label,minutes,...result};
}
export function diagnose(state,action,now){
  const inc=state.incident;if(inc?.phase!=='hold')throw new Error('Lot을 HOLD하고 조사한 뒤 판정하세요.');
  if(!CAUSES[action.cause])throw new Error('원인을 선택하세요.');if(!DISPOSITIONS[action.disposition])throw new Error('조치를 선택하세요.');
  const status=causeStatus(inc);
  inc.diagnosis=action.cause;inc.disposition=action.disposition;inc.diagnosedAt=now;inc.phase='action';
  inc.diagnosisBasis={status:status[action.cause],keyCheck:KEY[inc.cause],keyCheckBeforeDiagnosis:inc.checks.some(c=>c.kind===KEY[inc.cause])};
}
export function changeDisposition(state,disposition){
  const inc=state.incident;if(inc?.phase!=='action')throw new Error('조치 단계에서만 바꿀 수 있습니다.');if(!DISPOSITIONS[disposition])throw new Error('조치를 선택하세요.');
  inc.disposition=disposition;inc.action=null;inc.dispositionChanged=(inc.dispositionChanged??0)+1;
}
// 조치 실행. 이미 끊긴 배선·Contact는 버튼으로 복구하지 않습니다.
export function act(state,now){
  const inc=state.incident;if(inc?.phase!=='action')throw new Error('원인 판정 후 조치할 수 있습니다.');
  if(inc.action)throw new Error('이미 조치를 실행했습니다. 검증을 진행하세요.');
  const d=inc.disposition,minutes=Q.minutes.action[d];inc.minutes+=minutes;
  if(d==='reseat-retest')inc.probeSeated=true;
  if(d.startsWith('scrap'))inc.scrapped=true;
  inc.action={disposition:d,at:now,minutes};
  return {kind:'incident2-action',disposition:d,minutes,note:d==='reseat-retest'?'프로브 재접촉·테스터 점검 완료. 전기적 테스트를 다시 실행해 검증하세요.':d.startsWith('scrap')?'Lot 폐기 처리. 개선 조치가 맞는지 원인 검사로 검증하세요.':'추가 조치 없음.'};
}
// 검증: 재측정(재접촉 조치) 또는 원인 검사 재현(폐기 조치). 실패하면 조치 단계로 돌아갑니다.
export function verifyRetest(state,result,now){
  const inc=state.incident;if(!inc||inc.id!==ID||inc.phase!=='action'||inc.action?.disposition!=='reseat-retest')return;
  finishVerification(state,result.measurementStatus==='measured',now,result.measurementStatus==='measured'?'재측정에서 Id–Vg 곡선이 정상 측정됨':'재측정해도 OPEN 유지');
}
export function verifyScrap(state,now){
  const inc=state.incident;if(inc?.phase!=='action'||!inc.action)throw new Error('조치를 먼저 실행하세요.');
  const d=inc.action.disposition;if(d==='reseat-retest')throw new Error('재접촉 조치는 전기적 테스트 재측정으로 검증합니다.');
  let ok=false,note='결과대로 서명하는 조치는 OPEN 원인을 해결하지 못해 검증할 수 없어요.';
  if(d.startsWith('scrap')){
    const kind=d==='scrap-contact'?'contact-chain':'metal-continuity';
    if(!inc.checks.some(c=>c.kind===kind))check(state,kind,now);
    ok=inc.checks.find(c=>c.kind===kind).result.positive===true;
    note=ok?`${CHECKS[kind].label}에서 결함이 재현돼 개선 대상 공정이 맞음을 확인`:`${CHECKS[kind].label}는 정상. 이 조치로는 원인을 해결하지 못함`;
  }
  finishVerification(state,ok,now,note);
  return {kind:'incident2-verify',ok,note};
}
function finishVerification(state,ok,now,note){
  const inc=state.incident;inc.verification={ok,at:now,note,attempts:(inc.verification?.attempts??0)+1};
  if(!ok){inc.action=null;return;}
  inc.phase='closed';inc.resolvedAt=now;inc.evaluation=evaluate(inc);
}
export function evaluate(inc){
  const P=Q.points,causeOk=inc.diagnosis===inc.cause,best=BEST[inc.cause]===inc.disposition,keyFound=inc.diagnosisBasis?.keyCheckBeforeDiagnosis===true;
  const unnecessary=inc.checks.filter(c=>c.unnecessary).length,firstTry=inc.verification?.attempts===1&&!inc.dispositionChanged;
  const score=Math.max(0,Math.round((causeOk?P.cause:0)+(best?P.disposition:0)+(keyFound?P.keyEvidence:0)+(firstTry?P.verification:P.verification/2)+Math.max(0,P.efficiency-unnecessary*Q.unnecessaryPenalty)-Math.max(0,inc.minutes-Q.freeMinutes)*Q.minutePenalty));
  return {causeOk,dispositionOk:best,bestDisposition:best,keyEvidence:KEY[inc.cause],keyEvidenceFound:keyFound,diagnosisStatus:inc.diagnosisBasis?.status,unnecessaryChecks:unnecessary,
    order:inc.checks.map(c=>c.kind),verified:true,verificationAttempts:inc.verification.attempts,minutes:inc.minutes,score,
    meetings:inc.meetings?.length??0,aiMeetings:(inc.meetings??[]).filter(m=>m.source==='ai').length};
}
export function canRetest(state){const inc=state.incident;return inc?.id===ID&&inc.phase==='action'&&inc.action?.disposition==='reseat-retest';}
export function signGate(state,op,action){
  const inc=state.incident;if(inc?.id!==ID||op.modelId!=='electrical')return;
  if(['alarm','hold','action'].includes(inc.phase))throw new Error('OPEN 원인 조사·조치·검증을 마친 뒤 서명하세요.');
}
