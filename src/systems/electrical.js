import {ELECTRICAL as C,IMPLANT as I,PATTERN_ETCH as PE,ETCH as E} from '../constants.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const min=values=>values?.length?Math.min(...values):0;
export function thresholdVoltage(toxNm,substrateCm3,temperatureK){
  if(!Number.isFinite(toxNm)||toxNm<=0||!Number.isFinite(substrateCm3)||substrateCm3<=C.intrinsicCm3||!Number.isFinite(temperatureK)||temperatureK<=0)throw new Error('Vt 계산에 필요한 산화막·기판 도핑·온도가 올바르지 않습니다.');
  const thermalV=C.k*temperatureK/C.q,phiF=thermalV*Math.log(substrateCm3/C.intrinsicCm3);
  const coxFPerCm2=C.eps0FPerCm*C.oxideRelativePermittivity/(toxNm/C.nmPerCm);
  const depletionCPerCm2=Math.sqrt(4*C.q*C.eps0FPerCm*C.siliconRelativePermittivity*substrateCm3*phiF);
  return {vtV:C.flatBandV+2*phiF+depletionCPerCm2/coxFPerCm2,coxFPerCm2,phiF,substrateCm3};
}
export function squareLaw(vg,vd,vt,beta){
  const overdrive=vg-vt;if(overdrive<=0||vd<=0)return 0;
  return vd<overdrive?beta*(overdrive*vd-vd*vd/2):beta*overdrive*overdrive/2;
}
export function deviceParameters(state){
  const patterns=state.patterns??{},gate=patterns.gate??{},contact=patterns.contact??{},metal=patterns.metal??{},active=patterns.active??{};
  const l=C.nominalLengthUm-2*(gate.lateralLossNm??0)/1000;
  const widthFactor=clamp(1-(gate.overlayUm??0)/C.nominalWidthUm,0,1)*(1-(gate.defectFraction??0));
  const contactCoverage=clamp(1-(contact.overlayUm??0)/C.alignmentOpenUm,0,1)*(1-(contact.defectFraction??0));
  const wireWidth=C.wireWidthUm-2*(metal.lateralLossNm??0)/1000;
  const metalNm=min(state.geometry?.metal?.protectedValues);
  const polyNm=min(state.geometry?.poly?.protectedValues);
  const seriesSdOhm=2*(state.anneal?.sheetOhm??Number.MAX_VALUE)*C.accessLengthUm/C.nominalWidthUm;
  const seriesContactOhm=2*C.contactOhmPerTerminal/Math.max(.001,contactCoverage);
  const seriesMetalOhm=C.alResistivityOhmCm*(C.wireLengthUm/1e4)/(Math.max(.001,wireWidth)/1e4*Math.max(.001,metalNm)/C.nmPerCm);
  const blockers=[];
  if(!state.anneal||state.anneal.activeDoseCm2<=0)blockers.push({group:'sd',text:'활성화된 S/D가 없습니다.'});
  if(state.gateOxideNm<C.minOxideNm)blockers.push({group:'oxide',text:'게이트 산화막이 교육 모델의 유효 범위보다 얇습니다.'});
  if(l<C.minChannelLengthUm||polyNm<C.minPolyNm||(gate.defectFraction??0)>C.maxDefectFraction)blockers.push({group:'gate',text:'Gate 보호막 손실 또는 박리로 유효 게이트가 손상됐습니다.'});
  if((gate.maxResidualNm??0)>C.maxResidualNm)blockers.push({group:'gate',text:'S/D 영역에 Poly 잔사가 남았습니다.'});
  if((active.activeOxideNm??0)>C.maxResidualNm||(active.defectFraction??0)>C.maxDefectFraction)blockers.push({group:'isolation',text:'Active 개구 잔류막 또는 Field 박리 결함이 남았습니다.'});
  if(!state.contacts||contact.maxResidualNm>C.maxResidualNm||contactCoverage<=0||(contact.defectFraction??0)>C.maxDefectFraction)blockers.push({group:'contact',text:'Contact 잔사·박리·정렬로 유효 접촉 경로가 손상됐습니다.'});
  if(metalNm<C.minMetalNm||wireWidth<=0||(metal.maxResidualNm??0)>C.maxResidualNm||(metal.defectFraction??0)>C.maxDefectFraction)blockers.push({group:'metal',text:'금속 잔류 연결 또는 배선 손실 위험이 있습니다.'});
  return {toxNm:state.gateOxideNm,substrateCm3:state.substrateNaCm3??I.backgroundCm3,widthUm:C.nominalWidthUm*widthFactor,lengthUm:Math.max(.001,l),
    seriesSdOhm,seriesContactOhm,seriesMetalOhm,blockers,
    uniformity:Math.max(state.films?.poly?.nonuniformity??0,state.films?.ild?.nonuniformity??0,state.films?.metal?.nonuniformity??0)};
}
export function simulateDevice(parameters,conditions){
  if(conditions.temperatureK!==300||!Number.isInteger(conditions.samples)||conditions.samples<2||conditions.samples>501||!Number.isFinite(conditions.vdsV)||conditions.vdsV<=0||conditions.vdsV>5||!Number.isFinite(conditions.vgMinV)||!Number.isFinite(conditions.vgMaxV)||conditions.vgMinV<0||conditions.vgMaxV<=conditions.vgMinV||conditions.vgMaxV>5)throw new Error('측정 범위를 확인하세요. 현재 모델은 300 K, 0~5 V 범위를 지원합니다.');
  const threshold=thresholdVoltage(parameters.toxNm,parameters.substrateCm3,conditions.temperatureK);
  const beta=C.channelMobility*threshold.coxFPerCm2*parameters.widthUm/parameters.lengthUm;
  const resistance=parameters.seriesSdOhm+parameters.seriesContactOhm+parameters.seriesMetalOhm;
  const valid=parameters.blockers.length===0;
  const curve=Array.from({length:conditions.samples},(_,i)=>{
    const vgV=conditions.vgMinV+(conditions.vgMaxV-conditions.vgMinV)*i/(conditions.samples-1);
    const intrinsicIdA=squareLaw(vgV,conditions.vdsV,threshold.vtV,beta);
    let lo=0,hi=intrinsicIdA;
    for(let j=0;j<C.solverIterations;j++){
      const mid=(lo+hi)/2,expected=squareLaw(vgV-mid*resistance/2,Math.max(0,conditions.vdsV-mid*resistance),threshold.vtV,beta);
      if(mid>expected)hi=mid;else lo=mid;
    }
    return {vgV,idA:valid?(lo+hi)/2:null,intrinsicIdA};
  });
  return {...threshold,betaAperV2:beta,resistanceOhm:resistance,valid,ionA:curve.at(-1).idA,curve,parameters};
}
// Callback injection reuses the real process transitions without importing runsheet or UI here.
// Reference stops BEFORE the electrical operation, so there is no recursive test execution.
export function buildReferenceLot(flow,initial,transition){
  let s=initial;
  for(const stage of flow.stages){if(stage.number>=11)break;
    for(const op of stage.operations){
      const input=Object.fromEntries(op.parameters.map(p=>[p.key,p.target]));
      if(op.modelId==='boe')input.minutes=s.photo.referenceOxideNm/E.oxideRateNmPerMinute*(1+E.overetchFraction);
      if(op.modelId==='pattern-etch')input.minutes=s.photo.referenceFilmMaxNm/PE[op.material].rate*(1+PE.overetchFraction);
      const at='1970-01-01T00:00:00.000Z';
      s=transition(s,flow,{type:'execute',equipmentId:op.equipmentId,input},at);
      if(op.autoAdvance)continue;
      if(op.measurementRequired)s=transition(s,flow,{type:'measure',equipmentId:op.measurementEquipmentId},at);
      s=transition(s,flow,{type:'sign',equipmentId:op.measurementRequired?op.measurementEquipmentId:op.equipmentId,name:'기준 소자',acknowledgeDefects:true},at);
    }
  }return s;
}
export function gradeDevice(actual,reference,state,spec){
  const vtDeltaV=actual.vtV-reference.vtV,ionRelativeError=actual.ionA===null?null:(actual.ionA-reference.ionA)/reference.ionA;
  const failedInspections=state.records.filter(r=>!r.superseded&&r.measurement?.pass===false).length;
  const deductions={vt:Math.min(C.vtWeight,C.vtWeight*Math.abs(vtDeltaV)/spec.vtToleranceV),
    current:ionRelativeError===null?C.ionWeight:Math.min(C.ionWeight,C.ionWeight*Math.abs(ionRelativeError)/spec.ionToleranceFraction),
    uniformity:Math.min(C.uniformityWeight,Math.max(0,actual.parameters.uniformity-reference.parameters.uniformity)*100),
    inspections:Math.min(C.failedInspectionCap,failedInspections*C.failedInspectionWeight),rework:Math.min(C.reworkPenaltyCap,state.penaltyPoints??0)};
  const score=Math.max(0,Math.round(100-Object.values(deductions).reduce((a,b)=>a+b,0)));
  const inSpec=Math.abs(vtDeltaV)<=spec.vtToleranceV&&ionRelativeError!==null&&Math.abs(ionRelativeError)<=spec.ionToleranceFraction;
  const fatal=!actual.valid||Math.abs(vtDeltaV)>spec.vtHardToleranceV||ionRelativeError===null||Math.abs(ionRelativeError)>spec.ionHardToleranceFraction;
  const grade=fatal?'F':score>=spec.gradeCutoffs.S&&inSpec&&!failedInspections?'S':score>=spec.gradeCutoffs.A&&inSpec?'A':score>=spec.gradeCutoffs.B?'B':'F';
  return {score,grade,inSpec,vtDeltaV,ionRelativeError,deductions,failedInspections};
}
export function processFeedback(actual,reference,conditions){
  const groups=[
    {id:'oxide',label:'게이트 산화',keys:['toxNm','substrateCm3'],hint:'막이 두꺼워지면 Cox가 줄어 Vt와 전류가 달라집니다. 기판 도핑은 고정 교육값이며 S/D 도즈와 구분합니다.'},
    {id:'gate',label:'Gate 포토·Poly 식각',keys:['widthUm','lengthUm'],hint:'정렬·보호막·측면 식각은 유효 채널 폭/길이와 게이트 연속성에 반영됩니다.'},
    {id:'sd',label:'S/D 주입·어닐링',keys:['seriesSdOhm'],hint:'활성 도즈가 낮으면 면저항과 직렬 저항이 커져 전류가 감소합니다.'},
    {id:'contact',label:'Contact 포토·식각',keys:['seriesContactOhm'],hint:'잔류 절연막·박리·정렬 불량은 접촉 저항 또는 연결 불량으로 이어집니다.'},
    {id:'metal',label:'Al 증착·Metal 패터닝',keys:['seriesMetalOhm'],hint:'최소 두께와 배선 폭은 배선 저항에, 잔사·박리는 연결 결함 판정에 반영됩니다.'},
    {id:'isolation',label:'Active 포토·BOE',keys:[],hint:'Active 잔류막·Field 박리의 영향은 연결 유효성 판정과 후속 공정 상태에 남습니다.'}
  ];
  const items=groups.map(g=>{
    const p=structuredClone(actual.parameters);for(const key of g.keys)p[key]=reference.parameters[key];p.blockers=p.blockers.filter(b=>b.group!==g.id);
    const restored=simulateDevice(p,conditions),deltaVtV=restored.vtV-actual.vtV,deltaIonA=restored.ionA!==null&&actual.ionA!==null?restored.ionA-actual.ionA:null;
    const blockerCount=actual.parameters.blockers.filter(b=>b.group===g.id).length;
    const influence=Math.abs(deltaVtV)/C.feedbackVtScale+(deltaIonA===null?0:Math.abs(deltaIonA)/(reference.ionA*C.feedbackIonScale))+blockerCount*10;
    return {...g,deltaVtV,deltaIonA,blockerCount,influence};
  }).sort((a,b)=>b.influence-a.influence);
  const total=items.reduce((s,g)=>s+g.influence,0);return items.map(g=>({...g,relativeInfluence:total>0?g.influence/total:0}));
}
export function testElectrical(state,referenceState,conditions,spec){
  const actual=simulateDevice(deviceParameters(state),conditions),reference=simulateDevice(deviceParameters(referenceState),conditions);
  return {kind:'electrical',...actual,reference,conditions,specification:spec,...gradeDevice(actual,reference,state,spec),
    feedback:processFeedback(actual,reference,conditions),pass:actual.valid,
    limitations:['Vfb=0 V와 고정 채널 이동도는 교육용 가정 · 검증 필요','서브스레숄드·게이트 누설·채널 길이 변조·단채널 효과는 생략','연결 불량이면 유효 단자 Id–Vg를 산출하지 않으며 Vt는 재료 모델 값','공정별 영향은 한 그룹씩 기준 파라미터로 복원한 비교로, 합산 가능한 인과 기여도가 아님']};
}
