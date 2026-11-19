import test from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {applyAction,createLot,currentTask,latestRecord} from '../src/systems/runsheet.js';
import {buildLedger,reconcile,estimate,snapshot,specCheck,holdStatus,CAMPAIGN,operationsEvidence} from '../src/systems/campaign.js';
import {buildEvidencePacket,ruleBasedMeeting,sanitizeMeeting,rolesFor,validateMeetingAction} from '../src/systems/advisor.js';
import {playThrough,defaultInput} from './flowHelpers.js';

const T='2026-11-19T12:00:00Z';
const act=(s,a,at=T)=>applyAction(s,flow,a,at);
const start=(orderId='PO-001',cause,at=T)=>act(createLot(),{type:'start-campaign',orderId,cause},at);
const finished=(orderId,opts={})=>playThrough({initial:start(orderId,opts.cause,opts.at),...opts}).state;
// 현재 공정까지 진행(그 공정은 실행만 해 둠)
function runTo(state,opId){
  for(let i=0;i<200;i++){
    const t=currentTask(state,flow);if(!t)throw new Error('end');const op=t.operation,r=latestRecord(state,flow);
    if(op.id===opId&&!r)return act(state,{type:'execute',equipmentId:op.equipmentId,input:defaultInput(state,op)});
    if(!r)state=act(state,{type:'execute',equipmentId:op.equipmentId,input:defaultInput(state,op)});
    else if(op.measurementRequired&&!r.measurement)state=act(state,{type:'measure',equipmentId:op.measurementEquipmentId});
    else state=act(state,{type:'sign',equipmentId:op.measurementRequired?op.measurementEquipmentId:op.equipmentId,name:'QA',acknowledgeDefects:true});
  }throw new Error('bound');
}
const deviceState=s=>JSON.stringify({films:s.films,geometry:s.geometry,oxideNm:s.oxideNm,activeOxideNm:s.activeOxideNm,fieldOxideNm:s.fieldOxideNm,gateOxideNm:s.gateOxideNm,patterns:s.patterns,implant:s.implant,anneal:s.anneal,contacts:s.contacts});

test('자유 실습 모드는 그대로: 캠페인 없음, 1지점 측정으로도 서명 가능', () => {
  assert.equal(createLot().campaign,null);
  let s=runTo(createLot(),'field-oxidation');
  s=act(s,{type:'measure',equipmentId:'metrology',sites:['중앙']});
  s=act(s,{type:'sign',equipmentId:'metrology',name:'QA'});
  assert.equal(snapshot(s,flow),null);
  assert.throws(()=>act(s,{type:'campaign-close',decision:'ship'}),/캠페인 Lot이 아니에요/);
});

test('캠페인은 새 Lot의 첫 작업 전에만 시작하고 퀘스트를 따로 시작할 수 없음', () => {
  const s=start();assert.equal(s.campaign.orderId,'PO-001');assert.equal(s.records[0].operationId,'campaign-start');
  assert.throws(()=>act(act(createLot(),{type:'execute',equipmentId:'etcher'}),{type:'start-campaign',orderId:'PO-001'}),/첫 작업 전/);
  assert.throws(()=>act(s,{type:'start-incident',quest:'001'}),/퀘스트를 따로/);
  assert.equal(start('PO-002','bias').incident.id,'INCIDENT-001');
});

test('캠페인 측정 계획: 두께 공정은 5지점을 재야 서명 가능 (필수 계측 축소 우회 차단)', () => {
  let s=runTo(start(),'field-oxidation');
  s=act(s,{type:'measure',equipmentId:'metrology',sites:['중앙']});
  assert.throws(()=>act(s,{type:'sign',equipmentId:'metrology',name:'QA'}),/5지점/);
  s=act(s,{type:'measure',equipmentId:'metrology'});
  assert.doesNotThrow(()=>act(s,{type:'sign',equipmentId:'metrology',name:'QA'}));
});

test('원장: 기록 단위로 한 번씩 계산하고 계측 엔진 누적 시간과 일치', () => {
  const s=finished('PO-001'),L=buildLedger(s,flow);
  assert.ok(reconcile(s,L).metrologyMatch);
  const ids=L.entries.filter(e=>e.category==='process').map(e=>e.recordId);assert.equal(new Set(ids).size,ids.length);
  assert.equal(L.entries.filter(e=>e.category==='process').length,flow.stages.flatMap(x=>x.operations).length);
  assert.ok(Math.abs(L.totals.minutes-L.entries.reduce((a,e)=>a+e.minutes,0))<1e-9);
});

test('원장: INCIDENT 002 조사·조치·검증·회의 시간은 퀘스트 누적 시간과 같고 중복되지 않음', () => {
  let s=playThrough({initial:start('PO-003','probe-contact'),untilStage:11}).state;
  s=act(s,{type:'execute',equipmentId:'tester'});
  s=act(s,{type:'incident-hold'});
  s=act(s,{type:'incident2-check',equipmentId:'tester',check:'history'});
  s=act(s,{type:'incident2-check',equipmentId:'tester',check:'probe-reseat'});
  s=act(s,{type:'incident-meeting',...ruleBasedMeeting(buildEvidencePacket(s,'',flow)),source:'rules'});
  s=act(s,{type:'incident-diagnose',cause:'probe-contact',disposition:'reseat-retest'});
  s=act(s,{type:'incident2-act',equipmentId:'tester'});
  s=act(s,{type:'execute',equipmentId:'tester'});
  assert.equal(s.incident.phase,'closed');
  const L=buildLedger(s,flow),questMinutes=L.entries.filter(e=>['INCIDENT 002 설정','AI 회의 설정'].includes(e.source)).reduce((a,e)=>a+e.minutes,0);
  assert.equal(questMinutes,s.incident.minutes);
});

test('실제 시각과 무관: 같은 행동을 다른 시각에 해도 가상 시간·비용이 같음', () => {
  const a=buildLedger(finished('PO-001',{at:'2026-11-19T12:00:00Z'}),flow).totals,b=buildLedger(finished('PO-001',{at:'2026-12-01T03:33:00Z'}),flow).totals;
  assert.equal(a.minutes,b.minutes);assert.equal(a.cost,b.cost);
});

test('AI 회의: 응답 내용·추가 필드가 원장 시간·비용을 바꾸지 않음', () => {
  const s0=act(runTo(start('PO-002','bias'),'field-oxidation'),{type:'measure',equipmentId:'metrology'});
  assert.equal(s0.incident.phase,'alarm');const s1=act(s0,{type:'incident-hold'});
  const base=ruleBasedMeeting(buildEvidencePacket(s1,'',flow));
  const a=act(s1,{type:'incident-meeting',source:'rules',...base}),b=act(s1,{type:'incident-meeting',source:'ai',model:'x',...base,minutes:999,cost:-5000,quality:'S'},'2026-11-19T18:00:00Z');
  assert.deepEqual(buildLedger(a,flow).totals,buildLedger(b,flow).totals);
});

test('예상 완료: 시작 시 계획값, HOLD 중 미확정 표시, 판정한 조치는 알려진 항목으로 포함', () => {
  const e0=estimate(start(),flow);assert.equal(e0.uncertain.length,0);assert.ok(e0.etaMinutes>1000);assert.equal(e0.elapsedMinutes,0);
  let s=act(runTo(start('PO-002','bias'),'field-oxidation'),{type:'measure',equipmentId:'metrology'});
  s=act(s,{type:'incident-hold'});const e1=estimate(s,flow);
  assert.ok(e1.uncertain.some(u=>/HOLD/.test(u)));assert.equal(holdStatus(s).hold,true);
  let t=playThrough({initial:start('PO-003','contact-residue'),untilStage:11}).state;
  t=act(act(t,{type:'execute',equipmentId:'tester'}),{type:'incident-hold'});
  t=act(t,{type:'incident2-check',equipmentId:'tester',check:'contact-chain'});
  t=act(t,{type:'incident-diagnose',cause:'contact-residue',disposition:'scrap-contact'});
  assert.ok(estimate(t,flow).known.some(k=>/조치/.test(k.label)));
});

test('추가 검사는 정보만 주고 웨이퍼 상태를 바꾸지 않음', () => {
  let s=act(runTo(start('PO-002','overrun'),'field-oxidation'),{type:'measure',equipmentId:'metrology'});
  s=act(s,{type:'incident-hold'});const before=deviceState(s);
  s=act(s,{type:'check-reference',equipmentId:'metrology'});s=act(s,{type:'inspect-log',equipmentId:'furnace'});
  s=act(s,{type:'measure',equipmentId:'metrology'});
  assert.equal(deviceState(s),before);
  assert.ok(buildLedger(s,flow).totals.byCategory.inspection.count>=3);
});

test('정비: 다음 가동부터만 적용, 이미 가공된 막은 그대로, 이상 없으면 비용만 듦', () => {
  // 가공 전 정비: 산화로 타이머 고장이 웨이퍼에 닿지 않음
  let a=act(start('PO-002','overrun'),{type:'execute',equipmentId:'etcher'});a=act(a,{type:'sign',equipmentId:'etcher',name:'QA'});
  a=act(a,{type:'campaign-maintenance',equipmentId:'furnace',item:'furnace-pm'});
  a=runTo(a,'field-oxidation');assert.equal(a.incident.phase,'prevented');assert.equal(a.records.at(-1).result.hidden,undefined);
  // 가공 후 정비: 고장을 찾아도 이미 자란 막은 그대로
  let b=runTo(start('PO-002','overrun'),'field-oxidation');const grown=b.records.at(-1).result.thicknessNm;
  b=act(b,{type:'campaign-maintenance',equipmentId:'furnace',item:'furnace-pm'});
  assert.equal(b.records.findLast(r=>r.operationId==='field-oxidation').result.thicknessNm,grown);assert.equal(b.campaign.maintenance[0].found,true);
  // 이상 없는 정비: 시간·비용만
  let c=act(start('PO-001'),{type:'campaign-maintenance',equipmentId:'furnace',item:'furnace-pm'});
  assert.equal(c.campaign.maintenance[0].found,false);assert.equal(buildLedger(c,flow).totals.cost,CAMPAIGN.maintenance['furnace-pm'].cost);
  assert.throws(()=>act(c,{type:'campaign-maintenance',equipmentId:'furnace',item:'furnace-pm'}),/이미/);
  assert.throws(()=>act(c,{type:'campaign-maintenance',equipmentId:'metrology',item:'tester-pm'}),/해당 장비/);
  assert.throws(()=>act(createLot(),{type:'campaign-maintenance',equipmentId:'furnace',item:'furnace-pm'}),/캠페인 진행 중/);
  // OPEN 조사 중에는 테스터 정비로 우회 불가
  let d=playThrough({initial:start('PO-003','probe-contact'),untilStage:11}).state;d=act(act(d,{type:'execute',equipmentId:'tester'}),{type:'incident-hold'});
  assert.throws(()=>act(d,{type:'campaign-maintenance',equipmentId:'tester',item:'tester-pm'}),/INCIDENT 002 절차/);
});

test('종료: 서명 전·HOLD 중에는 출하 불가, 규격 적합 출하는 S', () => {
  assert.throws(()=>act(start(),{type:'campaign-close',decision:'ship'}),/최종 서명/);
  const s=act(finished('PO-001'),{type:'campaign-close',decision:'ship'}),ev=s.campaign.evaluation;
  assert.equal(ev.quality.status,'conforming');assert.equal(ev.delivery.status,'on-time');assert.equal(ev.cost.status,'within');assert.equal(ev.overall.grade,'S');
  assert.throws(()=>act(s,{type:'execute',equipmentId:'tester'}),/캠페인이 끝난/);
  assert.match(ev.disclaimer,/수율이나 공장 가동률을 뜻하지 않아요/);
});

test('규격 미달 제품은 빨리 출하해도 F, 출하 보류는 D', () => {
  const s=finished('PO-001',{override:op=>op.id==='gate-oxidation'?{timeMinutes:26}:null,acknowledge:true});
  assert.equal(specCheck(s).status,'nonconforming');
  assert.throws(()=>act(s,{type:'campaign-close',decision:'ship'}),/인지했다는 체크/);
  const shipped=act(s,{type:'campaign-close',decision:'ship',acknowledgeNonconforming:true}).campaign.evaluation;
  assert.equal(shipped.delivery.status,'on-time');assert.equal(shipped.cost.status,'within');assert.equal(shipped.overall.grade,'F');
  const held=act(s,{type:'campaign-close',decision:'withhold'}).campaign.evaluation;
  assert.equal(held.overall.grade,'D');assert.equal(held.judgment.rating,'적절');
});

test('OPEN 제품: HOLD 중 출하 불가, 원인 조치 후 폐기는 판단 적절이지만 미납', () => {
  let s=playThrough({initial:start('PO-003','contact-residue'),untilStage:11}).state;
  s=act(s,{type:'execute',equipmentId:'tester'});
  assert.throws(()=>act(s,{type:'campaign-close',decision:'ship'}),/최종 서명|HOLD/);
  s=act(s,{type:'incident-hold'});s=act(s,{type:'incident2-check',equipmentId:'tester',check:'contact-chain'});
  s=act(s,{type:'incident-diagnose',cause:'contact-residue',disposition:'scrap-contact'});s=act(s,{type:'incident2-act',equipmentId:'tester'});
  s=act(s,{type:'incident2-verify',equipmentId:'tester'});
  assert.equal(specCheck(s).status,'not-measured');
  const ev=act(s,{type:'campaign-close',decision:'scrap'}).campaign.evaluation;
  assert.equal(ev.quality.status,'scrapped');assert.equal(ev.delivery.status,'not-delivered');assert.equal(ev.overall.grade,'D');
});

test('AI 회의 패킷: 캠페인이면 QA·생산관리 추가, 운영 숫자는 원장 값, 숨은 원인 없음', () => {
  let s=act(runTo(start('PO-002','overrun'),'field-oxidation'),{type:'measure',equipmentId:'metrology'});s=act(s,{type:'incident-hold'});
  const p=buildEvidencePacket(s,'',flow),ops=p.evidence.find(e=>e.id==='OPS');
  assert.deepEqual(rolesFor(p),['PE','EE','MET','QA','PC']);
  assert.equal(ops.spent,buildLedger(s,flow).totals.cost);assert.equal(ops.dueMinutes,1600);
  assert.ok(!JSON.stringify(p).includes('overrun'));assert.ok(!JSON.stringify(p).includes('actualMinutes'));
  const rules=ruleBasedMeeting(p);assert.deepEqual(rules.opinions.map(o=>o.role),['PE','EE','MET','QA','PC']);
  assert.doesNotThrow(()=>validateMeetingAction({source:'rules',...rules}));
  const ai=JSON.stringify({opinions:['PE','EE','MET','QA'].map(role=>({role,hypothesis:'x',basis:['OPS'],next:'y',confidence:'high'})),summary:''});
  assert.throws(()=>sanitizeMeeting(ai,p),/PC 의견이 없습니다/);
  assert.equal(rolesFor(buildEvidencePacket(s,'')).length,3);
  assert.equal(operationsEvidence(createLot(),flow),null);
});
