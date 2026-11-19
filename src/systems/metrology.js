import {METROLOGY as M, DEPOSITION as D} from '../constants.js';
// 정밀 계측: 공정의 참값(record.result)은 숨기고, 장비 편향과 반복 오차가 섞인 관측값만 만듭니다.
// 난수는 Lot 첫 기록 시각 + 계측 순번으로 시드를 정해, 저장 재생 시에도 같은 값이 나옵니다.
export const SITE_NAMES=D.sampleNames;
export const THICKNESS_MODELS=['deal-grove','gate-oxide','deposit'];
export const isThicknessOperation=op=>THICKNESS_MODELS.includes(op?.modelId);
export function createMetrologyState(){return {biasNm:0,sitesSinceCalibration:0,events:0,minutes:0,referenceChecks:0,calibrations:0};}
function hash(text){let h=2166136261>>>0;for(const c of text){h^=c.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h;}
function mulberry32(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const gaussian=r=>Math.sqrt(-2*Math.log(Math.max(1e-12,r())))*Math.cos(2*Math.PI*r());
const round1=v=>Math.round(v*10)/10;
function stream(state){const m=state.metrology;m.events++;return mulberry32(hash(`${state.lotId}|${state.records[0]?.executedAt??''}|${m.events}`));}
export const sigmaFor=nm=>Math.max(M.repeatabilityFloorNm,Math.abs(nm)*M.repeatabilityFraction);
export function trueSites(result){
  if(result.kind==='deposition')return result.sites.map(s=>({name:s.name,trueNm:s.thicknessNm}));
  const factors=result.siteFactors??M.oxideSiteFactors;
  return SITE_NAMES.map((name,i)=>({name,trueNm:result.thicknessNm*factors[i]}));
}
export function normalizeSites(sites){
  if(sites===undefined)return [...SITE_NAMES];
  if(!Array.isArray(sites)||!sites.length)throw new Error('측정할 지점을 하나 이상 선택하세요.');
  for(const s of sites)if(!SITE_NAMES.includes(s))throw new Error('알 수 없는 측정 지점입니다.');
  return SITE_NAMES.filter(name=>sites.includes(name));
}
export function stats(values){
  const meanNm=values.reduce((a,b)=>a+b,0)/values.length,minNm=Math.min(...values),maxNm=Math.max(...values);
  return {meanNm,minNm,maxNm,nonuniformity:values.length>1&&meanNm>0?(maxNm-minNm)/(2*meanNm):null};
}
// 선택한 지점을 측정합니다. state.metrology를 변경합니다(호출 측에서 복제된 state 사용).
export function measureSites(state,result,sites){
  const m=state.metrology,r=stream(state),truth=trueSites(result);
  const observed=normalizeSites(sites).map(name=>{
    const t=truth.find(s=>s.name===name).trueNm,valueNm=round1(t+m.biasNm+gaussian(r)*sigmaFor(t));
    m.biasNm+=M.driftNmPerSite;m.sitesSinceCalibration++;return {name,valueNm};
  });
  const minutes=observed.length*M.minutesPerSite;m.minutes+=minutes;
  return {observed,...stats(observed.map(o=>o.valueNm)),coverage:observed.length/SITE_NAMES.length,minutes};
}
export function checkReference(state){
  const m=state.metrology,r=stream(state);
  const readings=Array.from({length:M.referenceRepeats},()=>round1(M.referenceNm+m.biasNm+gaussian(r)*sigmaFor(M.referenceNm)));
  const meanNm=readings.reduce((a,b)=>a+b,0)/readings.length;m.minutes+=M.referenceMinutes;m.referenceChecks++;
  return {kind:'metrology-reference',certifiedNm:M.referenceNm,uncertaintyNm:M.referenceUncertaintyNm,readings,meanNm,offsetNm:meanNm-M.referenceNm,minutes:M.referenceMinutes};
}
export function calibrate(state){
  const m=state.metrology;m.biasNm=0;m.sitesSinceCalibration=0;m.minutes+=M.calibrationMinutes;m.calibrations++;
  return {kind:'metrology-calibration',minutes:M.calibrationMinutes};
}
const fmt=v=>Number(v).toFixed(1);
export function describeMeasurement(m){
  const sites=m.observed.map(o=>`${o.name} ${fmt(o.valueNm)}`).join(' / ');
  return `평균 ${fmt(m.meanNm)} nm (${m.observed.length}점) · 목표 대비 ${(m.deviation*100).toFixed(1)}%\n${sites} nm\n${m.nonuniformity===null?'균일도: 1점 측정이라 판단 불가':`비균일도 ${(m.nonuniformity*100).toFixed(2)}%${m.coverage<1?' (일부 지점만 측정)':''}`}`;
}
// 사후 분석: 각 두께 공정의 마지막 측정값과 참값 비교
export function metrologyReview(state){
  return state.records.filter(r=>!r.superseded&&r.measurement?.metrology).map(r=>{
    const truth=trueSites(r.result),trueMean=truth.reduce((a,s)=>a+s.trueNm,0)/truth.length,trueStats=stats(truth.map(s=>s.trueNm));
    return {operationId:r.operationId,stageTitle:r.stageTitle,measuredMeanNm:r.measurement.meanNm,trueMeanNm:trueMean,errorNm:r.measurement.meanNm-trueMean,
      measuredNonuniformity:r.measurement.nonuniformity,trueNonuniformity:trueStats.nonuniformity,sites:r.measurement.observed.length,measuredPass:r.measurement.pass};
  });
}
