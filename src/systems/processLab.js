import LAB from '../data/process_lab.json' with {type:'json'};
import {depositFilm} from './fabrication.js';
import {createMetrologyState,measureSites,stats,SITE_NAMES} from './metrology.js';
import {currentTask} from './runsheet.js';
// 공정 개선 실험실(Poly LPCVD 비교). Lot 상태와 분리된 별도 객체에서만 동작하며, 원본 Lot·기록을 바꾸지 않습니다.
// 난수는 두 갈래로 분리해 저장합니다.
//  - 공정 산포(process draw): 실험 번호로 시드 → 측정 지점 선택과 무관하게 같은 참값
//  - 계측 오차(measurement): 세션 계측 장비 상태 + 측정 순번으로 시드 → 기존 계측 엔진 그대로
export {LAB};
export const VARIABLES={temperatureC:{label:'온도',unit:'°C'},minutes:{label:'시간',unit:'분'},zoneSpreadC:{label:'온도 편차',unit:'°C'}};
export const FIXED_ON_CLONE=['기준 Run의 LPCVD 직전 웨이퍼 상태(게이트 산화막·Field 산화막, PR 없음)','증착 모델 상수와 목표·허용범위(process_lab.json)','측정 위치 이름(중앙·북·동·남·서)'];
export const NEW_ON_RUN=['Run마다 새로 뽑는 공정 산포(증착률·위치별 편차 크기) — 실험 번호로 고정, 측정 방법과 무관','측정할 때마다 새로 생기는 계측 오차(반복 오차 + 세션 장비 드리프트, 세션 시작 시 교정 상태)'];
function hash(text){let h=2166136261>>>0;for(const c of text){h^=c.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h;}
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const normal=r=>Math.sqrt(-2*Math.log(Math.max(1e-12,r())))*Math.cos(2*Math.PI*r());
export function createLab(){return {version:1,baselines:[],session:null,history:[]};}
// 1. 완료된 Run을 읽기 전용 기준으로 저장(복사본). 원본 상태는 읽기만 합니다.
export function saveBaseline(lab,state,flow,now){
  if(currentTask(state,flow))throw new Error('완료된 Run(전기적 테스트 서명까지 끝난 Lot)만 기준으로 저장할 수 있어요.');
  const rec=[...state.records].reverse().find(r=>r.operationId===LAB.operationId&&!r.superseded);
  if(!rec?.measurement?.metrology)throw new Error('이 Run에는 Poly LPCVD 측정 기록이 없어요.');
  const runKey=`${state.lotId}|${state.records[0]?.executedAt}`;
  if(lab.baselines.some(b=>b.runKey===runKey))throw new Error('이미 기준으로 저장한 Run이에요.');
  if(lab.baselines.length>=LAB.limits.maxBaselines)throw new Error(`기준 Run은 최대 ${LAB.limits.maxBaselines}개까지 저장해요.`);
  const m=rec.measurement;
  const baseline=structuredClone({id:`B${lab.baselines.length+1}`,runKey,savedAt:now,lotId:state.lotId,
    recipe:{temperatureC:rec.input.temperatureC,minutes:rec.input.minutes,zoneSpreadC:rec.input.zoneSpreadC},
    observed:{sites:m.observed,meanNm:m.meanNm,nonuniformity:m.nonuniformity},
    preLpcvd:{gateOxideNm:state.gateOxideNm,fieldOxideNm:state.fieldOxideNm,activeOxideNm:state.activeOxideNm,prNm:0},
    hidden:{trueValues:rec.result.values,trueMeanNm:rec.result.meanNm,trueNonuniformity:rec.result.nonuniformity}});
  return {...lab,baselines:[...lab.baselines,baseline]};
}
// 2. 기준 Run의 LPCVD 직전 상태를 복제해 새 세션 시작
export function startSession(lab,baselineId,now){
  const b=lab.baselines.find(x=>x.id===baselineId);if(!b)throw new Error('기준 Run을 고르세요.');
  if(lab.session&&!lab.session.ended)throw new Error('진행 중인 세션을 먼저 종료하세요.');
  const id=`S${(hash(`${baselineId}|${now}`)%9000)+1000}`;
  return {...lab,history:lab.session?[...lab.history,lab.session]:lab.history,
    session:{id,baselineId,startedAt:now,preLpcvd:structuredClone(b.preLpcvd),metrology:createMetrologyState(),runs:[],selectedBest:null,confirmation:null,ended:false}};
}
export function processMinutes(input){const t=LAB.processTime;return input.minutes+t.fixedOverheadMinutes+t.stabilizationMinutesPerC*Math.max(0,t.stabilizationReferenceSpreadC-input.zoneSpreadC);}
function validate(input){
  const out={};for(const k of Object.keys(VARIABLES)){const v=Number(input?.[k]),[lo,hi]=LAB.limits[k];if(!Number.isFinite(v)||v<lo||v>hi)throw new Error(`${VARIABLES[k].label}는 ${lo}~${hi} ${VARIABLES[k].unit} 범위로 입력하세요.`);out[k]=v;}return out;
}
// 공정 참값: 기존 증착 모델 + Run 산포(실험 번호로 시드)
function processRun(session,input,key){
  const r=rng(hash(`${session.id}|${session.baselineId}|process|${key}`));
  const draw={rateFactor:1+LAB.runToRun.rateSigma*normal(r),uniformityFactor:Math.max(.5,1+LAB.runToRun.uniformitySigma*normal(r))};
  const model=depositFilm(LAB.material,input,null,LAB.goal.targetThicknessNm),mean=model.meanNm;
  const values=model.values.map(v=>(mean+(v-mean)*draw.uniformityFactor)*draw.rateFactor),s=stats(values);
  return {result:{kind:'deposition',material:LAB.material,values,sites:values.map((t,i)=>({name:SITE_NAMES[i],thicknessNm:t})),...s},draw};
}
export function changedVariables(input,reference){return Object.keys(VARIABLES).filter(k=>Math.abs(input[k]-reference[k])>1e-9);}
// 10. 목표 판정(데이터 정의). 일부 지점만 측정하면 균일도는 미확정 → 목표 충족으로 판정하지 않음.
export function evaluateGoal(m,goal=LAB.goal){
  const thicknessOk=Math.abs(m.meanNm-goal.targetThicknessNm)/goal.targetThicknessNm*100<=goal.thicknessTolerancePct;
  const full=m.observed.length>=goal.minSitesForUniformity,uniformityOk=full&&m.nonuniformity!==null&&m.nonuniformity*100<=goal.maxNonuniformityPct;
  const uniformityStatus=full?'confirmed':m.observed.length>1?'partial':'unknown';
  return {thicknessOk,uniformityOk:full?uniformityOk:null,uniformityStatus,status:!thicknessOk?'fail':!full?'insufficient':uniformityOk?'met':'fail'};
}
const pseudo=session=>({lotId:`LAB-${session.id}`,records:[{executedAt:session.startedAt}],metrology:session.metrology});
function measure(session,result,sites){const st=pseudo(session);const m=measureSites(st,result,sites);session.metrology=st.metrology;return m;}
function readPrediction(p){
  const reason=String(p?.reason??'').trim();if(reason.length<5)throw new Error('실행 전에 예상 결과의 이유를 5자 이상 적어주세요.');
  const meanNm=Number(p.meanNm),nonuniformityPct=Number(p.nonuniformityPct);
  if(!Number.isFinite(meanNm)||meanNm<=0)throw new Error('예상 평균 두께(nm)를 입력하세요.');
  if(!Number.isFinite(nonuniformityPct)||nonuniformityPct<0)throw new Error('예상 비균일도(%)를 입력하세요.');
  return {meanNm,nonuniformityPct,reason:reason.slice(0,300)};
}
export function runExperiment(lab,{input,sites,prediction},now){
  const s=structuredClone(lab.session);if(!s||s.ended)throw new Error('실험 세션을 먼저 시작하세요.');
  if(s.runs.length>=LAB.limits.maxExperiments)throw new Error(`실험은 세션당 최대 ${LAB.limits.maxExperiments}개예요.`);
  const x=validate(input),pred=readPrediction(prediction),base=lab.baselines.find(b=>b.id===s.baselineId);
  const ref=s.runs.at(-1)?.input??base.recipe,index=s.runs.length+1;
  const pre=structuredClone(s.preLpcvd);if(pre.prNm>0)throw new Error('복제한 웨이퍼에 PR이 남아 있어요.');
  const {result,draw}=processRun(s,x,`E${index}`),m=measure(s,result,sites);
  s.runs.push({index,kind:'experiment',at:now,input:x,changed:changedVariables(x,ref),changedFrom:s.runs.length?`실험 ${index-1}`:'기준 Run',
    prediction:pred,measurement:m,processMinutes:processMinutes(x),goal:evaluateGoal(m),hidden:{trueResult:result,draw}});
  return {...lab,session:s};
}
export function selectBest(lab,index){
  const s=structuredClone(lab.session);if(!s||s.ended)throw new Error('진행 중인 세션이 없어요.');
  const run=s.runs.find(r=>r.index===index);if(!run)throw new Error('실험을 고르세요.');
  if(run.goal.status!=='met')throw new Error('5지점 측정으로 목표를 충족한 실험만 고를 수 있어요.');
  s.selectedBest=index;s.confirmation=null;return {...lab,session:s};
}
// 11. 확인 Run: 같은 조건으로 새 Run(새 공정 산포) + 5지점 측정
export function runConfirmation(lab,now){
  const s=structuredClone(lab.session);if(!s||s.ended)throw new Error('진행 중인 세션이 없어요.');
  if(!s.selectedBest)throw new Error('먼저 가장 좋은 조건을 고르세요.');if(s.confirmation)throw new Error('이미 확인 Run을 했어요.');
  const best=s.runs.find(r=>r.index===s.selectedBest),{result,draw}=processRun(s,best.input,`C${s.selectedBest}`),m=measure(s,result,SITE_NAMES);
  const goal=evaluateGoal(m);
  s.confirmation={kind:'confirmation',at:now,fromIndex:best.index,input:best.input,measurement:m,processMinutes:processMinutes(best.input),goal,reproduced:goal.status==='met',hidden:{trueResult:result,draw}};
  return {...lab,session:s};
}
export function endSession(lab,now){const s=structuredClone(lab.session);if(!s||s.ended)throw new Error('진행 중인 세션이 없어요.');s.ended=true;s.endedAt=now;return {...lab,session:s};}
// 7. 화면용: 종료 전에는 hidden을 빼고 내보냄
export function publicRun(run){const {hidden,...rest}=run;return rest;}
export function reveal(session){
  if(!session?.ended)throw new Error('실험을 종료해야 사후 분석이 공개돼요.');
  return [...session.runs,...(session.confirmation?[session.confirmation]:[])].map(r=>{const t=r.hidden.trueResult;
    return {label:r.kind==='confirmation'?`확인 Run (실험 ${r.fromIndex})`:`실험 ${r.index}`,observedMeanNm:r.measurement.meanNm,trueMeanNm:t.meanNm,
      observedNonuniformity:r.measurement.nonuniformity,trueNonuniformity:t.nonuniformity,sites:r.measurement.observed.length,rateFactor:r.hidden.draw.rateFactor,uniformityFactor:r.hidden.draw.uniformityFactor,
      trueGoal:evaluateGoal({meanNm:t.meanNm,nonuniformity:t.nonuniformity,observed:SITE_NAMES.map(n=>({name:n}))}).status};});
}
export const CSV_COLUMNS=['session','baseline','kind','index','temperatureC','minutes','zoneSpreadC','changedVariables','changedFrom','intentReason','predictedMeanNm','predictedNonuniformityPct','sites','siteValuesNm','observedMeanNm','observedNonuniformityPct','uniformityStatus','goalStatus','predictionErrorNm','processMinutes','measurementMinutes','selectedBest','reproduced','trueMeanNm','trueNonuniformityPct','processRateFactor'];
const cell=v=>{const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
export function labCsv(session){
  const rows=[...session.runs,...(session.confirmation?[session.confirmation]:[])].map(r=>{const m=r.measurement,t=session.ended?r.hidden.trueResult:null;
    return {session:session.id,baseline:session.baselineId,kind:r.kind,index:r.kind==='confirmation'?`C${r.fromIndex}`:r.index,...r.input,changedVariables:(r.changed??[]).join('|'),changedFrom:r.changedFrom??'',
      intentReason:r.prediction?.reason??'',predictedMeanNm:r.prediction?.meanNm??'',predictedNonuniformityPct:r.prediction?.nonuniformityPct??'',sites:m.observed.map(o=>o.name).join('|'),siteValuesNm:m.observed.map(o=>o.valueNm).join('|'),
      observedMeanNm:m.meanNm.toFixed(2),observedNonuniformityPct:m.nonuniformity===null?'':(m.nonuniformity*100).toFixed(3),uniformityStatus:r.goal.uniformityStatus,goalStatus:r.goal.status,
      predictionErrorNm:r.prediction?(m.meanNm-r.prediction.meanNm).toFixed(2):'',processMinutes:r.processMinutes.toFixed(1),measurementMinutes:m.minutes,
      selectedBest:r.kind==='experiment'&&session.selectedBest===r.index?'yes':'',reproduced:r.kind==='confirmation'?String(r.reproduced):'',
      trueMeanNm:t?t.meanNm.toFixed(2):'',trueNonuniformityPct:t?(t.nonuniformity*100).toFixed(3):'',processRateFactor:t?r.hidden.draw.rateFactor.toFixed(4):''};});
  return [CSV_COLUMNS.join(','),...rows.map(r=>CSV_COLUMNS.map(c=>cell(r[c])).join(','))].join('\n');
}
