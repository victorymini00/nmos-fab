import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {applyAction,createLot,latestRecord,currentTask} from '../src/systems/runsheet.js';
import {metrologyReview} from '../src/systems/metrology.js';
import {createPersistence} from '../src/systems/storage.js';
import {playThrough,defaultInput} from './flowHelpers.js';
const at='2026-11-19T12:00:00Z';
const go=(s,a)=>applyAction(s,flow,a,at);
function toOxidation(cause){
  let s=createLot();s=go(s,{type:'start-incident',cause});
  s=playThrough({untilStage:1,initial:s}).state;
  return go(s,{type:'execute',equipmentId:'furnace',input:defaultInput(s,currentTask(s,flow).operation)});
}
const measure=sites=>({type:'measure',equipmentId:'metrology',...(sites?{sites}:{})});
for(const cause of ['bias','overrun','local'])test(`${cause}: full 5-point measurement raises OOS alarm and blocks signing until HOLD + diagnosis`,()=>{
  let s=go(toOxidation(cause),measure());assert.equal(s.incident.phase,'alarm');
  assert.throws(()=>go(s,{type:'sign',equipmentId:'metrology',name:'QA',acknowledgeDefects:true}),/OOS/);
  assert.throws(()=>go(s,{type:'incident-diagnose',cause,disposition:'use-as-is'}));
  s=go(s,{type:'incident-hold'});assert.equal(s.incident.phase,'hold');
});
test('evidence separates the causes: reference sample exposes bias, furnace log exposes overrun, map exposes local',()=>{
  const ev=cause=>{let s=go(go(toOxidation(cause),measure()),{type:'incident-hold'});
    s=go(s,{type:'check-reference',equipmentId:'metrology'});const ref=s.records.at(-1).result.offsetNm;
    s=go(s,{type:'inspect-log',equipmentId:'furnace'});const log=s.records.at(-1).result;
    s=go(s,measure());const m=latestRecord(s,flow).measurement;
    return {ref,overrun:log.actualMinutes>log.recipeMinutes,south:m.observed.find(o=>o.name==='남').valueNm-m.observed.find(o=>o.name==='중앙').valueNm,s};};
  const b=ev('bias'),o=ev('overrun'),l=ev('local');
  assert.ok(b.ref>30);assert.ok(Math.abs(o.ref)<3&&Math.abs(l.ref)<3);
  assert.ok(o.overrun);assert.ok(!b.overrun&&!l.overrun);
  assert.ok(l.south>40);assert.ok(Math.abs(b.south)<10&&Math.abs(o.south)<10);
  assert.deepEqual(b.s.incident.evidence.sort(),['log','map','reference']);assert.ok(b.s.incident.minutes>=6+5+10);
});
test('correct diagnosis + best disposition + key evidence scores highest; bias case passes after calibration',()=>{
  let s=go(go(toOxidation('bias'),measure()),{type:'incident-hold'});
  s=go(s,{type:'check-reference',equipmentId:'metrology'});
  s=go(s,{type:'incident-diagnose',cause:'bias',disposition:'remeasure'});
  assert.deepEqual([s.incident.evaluation.causeOk,s.incident.evaluation.bestDisposition,s.incident.evaluation.keyEvidenceFound],[true,true,true]);assert.equal(s.incident.evaluation.score,100);
  assert.throws(()=>go(s,{type:'sign',equipmentId:'metrology',name:'QA'}));
  s=go(s,{type:'calibrate',equipmentId:'metrology'});s=go(s,measure());assert.equal(latestRecord(s,flow).measurement.pass,true);
  s=go(s,{type:'sign',equipmentId:'metrology',name:'QA'});assert.equal(currentTask(s,flow).operation.id,'active-hmds');
});
test('wrong diagnosis is scored low; overrun accepted as-is lets the lot continue with real thicker field oxide',()=>{
  let s=go(go(toOxidation('overrun'),measure()),{type:'incident-hold'});
  const wrong=go(s,{type:'incident-diagnose',cause:'bias',disposition:'remeasure'});assert.equal(wrong.incident.evaluation.causeOk,false);assert.ok(wrong.incident.evaluation.score<=20);
  s=go(s,{type:'inspect-log',equipmentId:'furnace'});s=go(s,{type:'incident-diagnose',cause:'overrun',disposition:'use-as-is'});assert.equal(s.incident.evaluation.score,100);
  assert.throws(()=>go(s,{type:'sign',equipmentId:'metrology',name:'QA'}));
  s=go(s,{type:'sign',equipmentId:'metrology',name:'QA',acknowledgeDefects:true});assert.ok(s.fieldOxideNm>375.6*1.1);
  const done=playThrough({initial:s,acknowledge:true}).state;assert.equal(done.electrical.grade==='F',false);
});
test('local defect is missed when only the center is measured, and recorded as missed on signing',()=>{
  let s=go(toOxidation('local'),measure(['중앙']));assert.equal(s.incident.phase,'armed');
  s=go(s,{type:'sign',equipmentId:'metrology',name:'QA'});assert.equal(s.incident.phase,'missed');
  const review=metrologyReview(playThrough({initial:s,acknowledge:true}).state)[0];assert.ok(review.trueNonuniformity>.05);assert.equal(review.measuredNonuniformity,null);
});
test('quest only starts before field oxidation; cause is seeded and replay-stable',()=>{
  assert.throws(()=>go(playThrough({untilStage:2}).state,{type:'start-incident'}));
  let value=null;const store=()=>({getItem:()=>value,setItem:(k,v)=>value=v}),p=createPersistence(store,flow);
  let s=createLot();const actions=[{type:'start-incident'},{type:'execute',equipmentId:'etcher'}];
  for(const a of actions){s=go(s,a);p.record(a,at);}
  assert.deepEqual(createPersistence(store,flow).load().state,s);assert.ok(['bias','overrun','local'].includes(s.incident.cause));
});
