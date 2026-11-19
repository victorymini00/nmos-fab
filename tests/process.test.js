import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {growOxide} from '../src/systems/physics.js';
import {createLot,applyAction,currentTask,nextEquipment} from '../src/systems/runsheet.js';
import {createPersistence} from '../src/systems/storage.js';
const recipe={temperatureC:1000,timeMinutes:60,ambient:'wet'};
const clean={type:'execute',equipmentId:'etcher'};
const signedClean={type:'sign',equipmentId:'etcher',name:'Engineer Kim'};
const oxide={type:'execute',equipmentId:'furnace',input:recipe};
const measure={type:'measure',equipmentId:'metrology'};
const sign={type:'sign',equipmentId:'metrology',name:'Engineer Kim'};
const ready=()=>applyAction(applyAction(createLot(),flow,clean),flow,signedClean);
test('Deal-Grove matches independent reference at 1000C, retains units and initial oxide',()=>{
  const r=growOxide({...recipe,initialOxideNm:2});
  assert.ok(Math.abs(r.thicknessNm-375.58557359)<1e-6);
  const x=r.thicknessNm/1000,xi=.002;
  assert.ok(Math.abs(x*x+r.Aum*x-(xi*xi+r.Aum*xi+r.Bum2PerHour))<1e-12);
  assert.ok(Math.abs(growOxide({...recipe,timeMinutes:0,initialOxideNm:2}).thicknessNm-2)<1e-10);
});
test('wet/dry, temperature, duration and cumulative oxide follow expected trends',()=>{
  const f=extra=>growOxide({...recipe,initialOxideNm:2,...extra}).thicknessNm;
  assert.ok(f({})>f({ambient:'dry'}));assert.ok(f({temperatureC:1100})>f({}));assert.ok(f({timeMinutes:120})>f({}));
  const first=f({timeMinutes:30});assert.ok(Math.abs(f({timeMinutes:30,initialOxideNm:first})-f({}))<1e-9);
  assert.ok(f({initialOxideNm:400})>400);
});
test('invalid process inputs cannot modify the Lot',()=>{
  const initial=ready(),snapshot=structuredClone(initial);
  for(const input of [{...recipe,temperatureC:NaN},{...recipe,timeMinutes:0},{...recipe,ambient:'nitrogen'},{...recipe,timeMinutes:241}])assert.throws(()=>applyAction(initial,flow,{...oxide,input}));
  assert.deepEqual(initial,snapshot);
});
test('clean -> signed clean -> oxidation -> metrology -> signature; no stage skipping',()=>{
  let state=createLot();assert.throws(()=>applyAction(state,flow,oxide));assert.throws(()=>applyAction(state,flow,measure));
  state=applyAction(state,flow,clean);assert.equal(state.cursor,0);assert.throws(()=>applyAction(state,flow,oxide));
  state=applyAction(state,flow,signedClean);assert.equal(currentTask(state,flow).stage.number,1);
  state=applyAction(state,flow,oxide);assert.equal(nextEquipment(state,flow),'metrology');
  assert.throws(()=>applyAction(state,flow,sign));assert.throws(()=>applyAction(state,flow,oxide));
  assert.throws(()=>applyAction(state,flow,{...measure,equipmentId:'furnace'}));
  state=applyAction(state,flow,measure);assert.equal(state.cursor,1);assert.equal(state.records[1].measurement.thicknessNm,375.6);
  assert.throws(()=>applyAction(state,flow,{...sign,name:'  '}));
  state=applyAction(state,flow,sign);assert.equal(state.cursor,2);assert.equal(currentTask(state,flow).stage.number,2);assert.ok(state.records.every(r=>r.signature));
});
test('failed metrology blocks signing; rework accumulates and invalidates earlier measurement',()=>{
  let state=ready();state=applyAction(state,flow,{...oxide,input:{...recipe,timeMinutes:20}});state=applyAction(state,flow,measure);
  assert.equal(state.records.at(-1).measurement.pass,false);assert.equal(nextEquipment(state,flow),'furnace');assert.throws(()=>applyAction(state,flow,sign));
  const before=state.oxideNm;state=applyAction(state,flow,{...oxide,input:{...recipe,timeMinutes:40}});
  assert.ok(state.oxideNm>before);assert.ok(Math.abs(state.oxideNm-375.58557359)<1e-6);
  assert.equal(state.records[1].superseded,true);assert.equal(state.records[2].measurement,null);assert.equal(state.records[2].rework,true);
  assert.throws(()=>applyAction(state,flow,sign));state=applyAction(state,flow,measure);assert.equal(state.records.at(-1).measurement.pass,true);state=applyAction(state,flow,sign);assert.equal(state.cursor,2);
});
test('save replay preserves gates and rejects corrupt saves; inaccessible storage is nonfatal',()=>{
  let value=null;const get=()=>({getItem:()=>value,setItem:(k,v)=>value=v});let p=createPersistence(get,flow);
  for(const a of [clean,signedClean,oxide,measure])p.record(a,'2026-11-19T10:00:00.000Z');
  let restored=createPersistence(get,flow).load();assert.equal(restored.state.cursor,1);assert.equal(restored.state.records.at(-1).measurement.pass,true);
  value='{"version":1,"events":[{"at":"2026-11-19","action":{"type":"sign","equipmentId":"metrology","name":"skip"}}]}';
  restored=createPersistence(get,flow).load();assert.equal(restored.state.cursor,0);assert.ok(restored.notice);
  p=createPersistence(()=>{throw new Error('blocked');},flow);assert.equal(p.load().state.cursor,0);assert.equal(p.record(clean,'2026-11-19T10:00:00.000Z'),false);assert.equal(p.reset(),false);
});
