import {describeMeasurement,isThicknessOperation} from './metrology.js';
const one=v=>Number(v).toFixed(1),pct=v=>(100*v).toFixed(2);
const choices={dry:'건식',wet:'습식',apply:'처리',skip:'생략',on:'켜짐',off:'꺼짐'};
const testLabels={temperatureK:['측정 온도','K'],vdsV:['Vds','V'],vgMinV:['Vg 시작','V'],vgMaxV:['Vg 종료','V'],samples:['스윕 지점','점']};
export const signedElectrical=state=>state.records.findLast(r=>r.result.kind==='electrical'&&r.signature);
export function describeResult(r){
  if(r.kind==='metrology-reference')return `기준 시료 ${one(r.certifiedNm)} nm\n측정 ${r.readings.map(one).join(' / ')} nm\n편차 ${r.offsetNm>=0?'+':''}${one(r.offsetNm)} nm`;
  if(r.kind==='metrology-calibration')return '계측 장비 교정 · 편향 초기화';
  if(r.metrology)return describeMeasurement(r);
  if(r.kind==='electrical')return `Vt ${r.vtV.toFixed(3)} V\nIon ${r.ionA===null?'산출불가':(r.ionA*1000).toFixed(3)+' mA'}\n${r.grade} / ${r.score}점`;
  if(r.kind==='deposition')return `평균 ${one(r.meanNm)} nm / ${one(r.rateNmPerMinute)} nm/분\n최소 ${one(r.minNm)} / 최대 ${one(r.maxNm)} nm\n비균일도 ${pct(r.nonuniformity)}%\n${r.sites.map(s=>s.name+' '+one(s.thicknessNm)).join(' / ')} nm${r.contactReady===false?'\nContact 불량 누적':''}`;
  if(r.kind==='pattern-etch')return `${r.status} / 잔류 ${one(r.maxResidualNm)} nm\n보호부 최소 ${one(r.protectedMinNm)} nm\n하부 손실 ${one(r.maxUnderlyingLossNm)} nm\n정렬 ${one(r.overlayUm)} µm / 박리 ${pct(r.defectFraction)}%\n누적 ${one(r.totalMinutes)}분`;
  if(r.kind==='anneal')return `접합 ${one(r.junctionNm)} nm\n면저항 ${one(r.sheetOhm)} Ω/□\n활성화 ${pct(r.activation)}%\n피크 ${r.peakCm3.toExponential(2)} cm⁻³`;
  if(r.kind==='implant')return `Rp ${one(r.rpNm)} / ΔRp ${one(r.straggleNm)} nm\n유효 도즈 ${r.effectiveDoseCm2.toExponential(2)} cm⁻²\n투과 ${pct(r.transmission)}%`;
  if(r.kind==='strip')return 'PR 제거 완료';
  if(r.thicknessNm!==undefined)return `산화막 ${one(r.thicknessNm)} nm${r.warning?'\n초기 건식 성장 보정 생략':''}`;
  if(r.status)return `${r.status}\nActive ${one(r.activeOxideNm)} / Field ${one(r.fieldOxideNm)} nm\n박리 ${pct(r.defectFraction)}% / 정렬 ${one(r.overlayUm)} µm\n언더컷 ${one(r.undercutNm)} nm`;
  if(r.openingPrNm!==undefined)return `PR 잔사 ${one(r.openingPrNm)} nm\n보호 PR ${one(r.protectedPrNm)} nm\n박리 ${pct(r.defectFraction)}% / 정렬 ${one(r.overlayUm)} µm`;
  if(r.prNm!==undefined)return `PR ${one(r.prNm)} nm\n소프트베이크 ${r.softBakeC}°C / ${r.softBakeSeconds}초`;
  if(r.overlayUm!==undefined)return `정렬 ${one(r.overlayUm)} µm\n노광 ${r.dose} mJ/cm²`;
  if(r.hmds!==undefined)return `HMDS ${r.hmds?'처리':'생략'}\n접착 지수 ${r.adhesion}`;
  if(r.penaltyPoints)return `재작업 감점 ${r.penaltyPoints}점`;
  return '웨이퍼 입고·RCA 세정 완료';
}
export function reportRows(state,flow,layout){
  const tasks=flow.stages.flatMap(stage=>stage.operations.map(op=>({stage,op})));
  return state.records.map(record=>{
    const op=tasks.find(t=>t.op.id===record.operationId)?.op;
    const parameters=op?.parameters??[];
    const target=op?.modelId==='electrical'?`${op.testConditions.temperatureK} K / Vds ${op.testConditions.vdsV} V\nVg ${op.testConditions.vgMinV}~${op.testConditions.vgMaxV} V\nVt ±${op.specification.vtToleranceV} V / Ion ±${100*op.specification.ionToleranceFraction}%`:parameters.map(p=>`${p.label} ${choices[p.target]??p.target} ${p.unit}`).join('\n')||(op?.modelId==='strip'?'PR 완전 제거':'웨이퍼 1장 / RCA 세정');
    const input=Object.entries(record.input).map(([key,value])=>{const p=parameters.find(p=>p.key===key),fallback=op?.modelId==='electrical'?testLabels[key]:null;return `${p?.label??fallback?.[0]??key} ${choices[value]??value}${p?.unit?' '+p.unit:fallback?' '+fallback[1]:''}`;}).join('\n')||'실행 확인';
    const signature=record.signature?`${record.signature.name}${record.signature.acknowledgedDefects?' / 결함 인지':''}\n서명 ${record.signature.signedAt}`:record.autoCompleted?'자동 기록 완료':'확인 대기';
    return {recordId:record.id,cells:[`${record.stageNumber}. ${record.stageTitle}\n${record.operationId}${record.rework?'\n재작업':''}${record.superseded?'\n이전 이력':''}`,
      layout.equipment.find(e=>e.id===record.equipmentId)?.name??record.equipmentId,target+(op?.targetThicknessNm?'\n평균 '+op.targetThicknessNm+' nm':''),
      input,(isThicknessOperation(op)?'실제 값(사후 공개)\n':'')+describeResult(record.result),record.measurement?`${record.measurement.pass?'합격':'결함 / 조건 이탈'}\n${describeResult(record.measurement)}\n측정 ${record.measurement.measuredAt}`:'해당 없음',
      signature+`\n실행 ${record.executedAt}`]};
  });
}
export function reportData(state,flow,layout){
  if(!state.electrical||!signedElectrical(state))throw new Error('전기적 테스트 결과를 확인하고 서명한 뒤 저장하세요.');
  return {lotId:state.lotId,result:state.electrical,rows:reportRows(state,flow,layout),recordCount:state.records.length,
    completedAt:signedElectrical(state).signature.signedAt,
    columns:['단계 / 작업','장비','목표 조건','실제 입력','계산 결과','계측 기록','확인 서명 / 시간']};
}
