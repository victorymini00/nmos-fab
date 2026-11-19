import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {applyAction,latestRecord,currentTask} from '../src/systems/runsheet.js';
import {metrologyReview,sigmaFor,SITE_NAMES} from '../src/systems/metrology.js';
import {METROLOGY as M} from '../src/constants.js';
import {createPersistence} from '../src/systems/storage.js';
import {playThrough,defaultInput} from './flowHelpers.js';
const at='2026-11-19T12:00:00Z',measure=sites=>({type:'measure',equipmentId:'metrology',...(sites?{sites}:{})});
const oxidized=()=>{let s=playThrough({untilStage:1}).state;return applyAction(s,flow,{type:'execute',equipmentId:'furnace',input:defaultInput(s,currentTask(s,flow).operation)},at);};
test('observed thickness = truth + bias + noise: close to, but not identical with, the hidden value',()=>{
  const s=applyAction(oxidized(),flow,measure(),at),r=latestRecord(s,flow),m=r.measurement;
  assert.equal(m.observed.length,5);assert.deepEqual(m.observed.map(o=>o.name),SITE_NAMES);
  for(const [i,o] of m.observed.entries()){const truth=r.result.thicknessNm*M.oxideSiteFactors[i];assert.ok(Math.abs(o.valueNm-truth)<5*sigmaFor(truth)+1);}
  assert.ok(m.pass);assert.equal(s.metrology.minutes,5*M.minutesPerSite);
});
test('same actions replay to identical measurements (seeded, storage-safe)',()=>{
  const a=applyAction(oxidized(),flow,measure(['중앙','동']),at),b=applyAction(oxidized(),flow,measure(['중앙','동']),at);
  assert.deepEqual(latestRecord(a,flow).measurement,latestRecord(b,flow).measurement);
  let value=null;const p=createPersistence(()=>({getItem:()=>value,setItem:(k,v)=>value=v}),flow),done=playThrough({untilStage:2});
  for(const e of done.events)p.record(e,at);assert.deepEqual(createPersistence(()=>({getItem:()=>value,setItem:()=>{}}),flow).load().state,done.state);
});
test('site selection: single site cannot judge uniformity; re-measuring keeps history',()=>{
  let s=applyAction(oxidized(),flow,measure(['중앙']),at);let m=latestRecord(s,flow).measurement;
  assert.equal(m.nonuniformity,null);assert.equal(m.coverage,.2);
  s=applyAction(s,flow,measure(),at);const r=latestRecord(s,flow);assert.equal(r.measurements.length,2);assert.equal(r.measurement.observed.length,5);
  assert.throws(()=>applyAction(s,flow,measure([]),at));assert.throws(()=>applyAction(s,flow,measure(['모서리']),at));
});
test('drift accumulates; reference sample reveals offset; calibration removes it',()=>{
  let s=oxidized();for(let i=0;i<6;i++)s=applyAction(s,flow,measure(),at);
  assert.ok(Math.abs(s.metrology.biasNm-30*M.driftNmPerSite)<1e-9);
  s=applyAction(s,flow,{type:'check-reference',equipmentId:'metrology'},at);const ref=s.records.at(-1).result;
  assert.ok(Math.abs(ref.offsetNm-30*M.driftNmPerSite)<1.5);assert.equal(ref.readings.length,M.referenceRepeats);
  s=applyAction(s,flow,{type:'calibrate',equipmentId:'metrology'},at);assert.equal(s.metrology.biasNm,0);assert.equal(s.metrology.calibrations,1);
  assert.throws(()=>applyAction(s,flow,{type:'calibrate',equipmentId:'furnace'},at));
  assert.equal(currentTask(s,flow).operation.id,'field-oxidation');
});
test('measuring only the center can miss a non-uniform poly film that full 5-site mapping catches',()=>{
  let s=playThrough({untilStage:5}).state;const op=currentTask(s,flow).operation;
  s=applyAction(s,flow,{type:'execute',equipmentId:'deposition',input:{...defaultInput(s,op),zoneSpreadC:15}},at);
  const center=applyAction(s,flow,measure(['중앙']),at),full=applyAction(s,flow,measure(),at);
  assert.equal(latestRecord(center,flow).measurement.pass,true);assert.equal(latestRecord(full,flow).measurement.pass,false);
});
test('post-lot review compares last measured mean with hidden truth for every thickness step',()=>{
  const review=metrologyReview(playThrough().state);
  assert.deepEqual(review.map(r=>r.operationId),['field-oxidation','gate-oxidation','poly-deposition','ild-deposition','al-deposition']);
  for(const r of review)assert.ok(Math.abs(r.errorNm)<5);
});
