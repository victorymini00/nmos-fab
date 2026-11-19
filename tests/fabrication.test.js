import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import map from '../src/data/map_layout.json' with {type:'json'};
import {depositFilm,filmStats,implantPhosphorus,annealImplant} from '../src/systems/fabrication.js';
import {applyAction,currentTask,latestRecord,operations,recommendedPatternEtchMinutes} from '../src/systems/runsheet.js';
import {createPersistence} from '../src/systems/storage.js';
import {playThrough,defaultInput} from './flowHelpers.js';
const poly={temperatureC:620,minutes:20,zoneSpreadC:1},metal={powerW:200,minutes:5,rotation:'on'};
const exec=(equipmentId,input={})=>({type:'execute',equipmentId,input});
const measure={type:'measure',equipmentId:'metrology'};
const sign={type:'sign',equipmentId:'metrology',name:'QA'};
test('deposition separates rate, time, 5-site spatial map and scale-independent nonuniformity',()=>{
  const a=depositFilm('poly',poly),b=depositFilm('poly',{...poly,minutes:40}),hot=depositFilm('poly',{...poly,temperatureC:640}),spread=depositFilm('poly',{...poly,zoneSpreadC:12});
  assert.equal(a.rateNmPerMinute,10);assert.equal(a.meanNm,200);assert.equal(a.values.length,5);assert.equal(b.meanNm,400);
  assert.ok(Math.abs(b.nonuniformity-a.nonuniformity)<1e-12);assert.ok(hot.rateNmPerMinute>a.rateNmPerMinute);assert.ok(spread.nonuniformity>a.nonuniformity);assert.equal(spread.pass,false);
  const accumulated=depositFilm('poly',poly,a.values);assert.equal(accumulated.meanNm,400);assert.equal(accumulated.pass,false);
  assert.deepEqual(filmStats(a.values),{meanNm:a.meanNm,minNm:a.minNm,maxNm:a.maxNm,nonuniformity:a.nonuniformity});
});
test('Al power increases rate and time cannot repair missing substrate rotation',()=>{
  const a=depositFilm('metal',metal),b=depositFilm('metal',{...metal,powerW:400}),staticFilm=depositFilm('metal',{...metal,rotation:'off'}),longStatic=depositFilm('metal',{...metal,rotation:'off',minutes:10});
  assert.equal(a.meanNm,500);assert.equal(b.rateNmPerMinute,200);assert.equal(b.meanNm,1000);assert.ok(staticFilm.nonuniformity>.1);assert.equal(staticFilm.pass,false);assert.equal(longStatic.nonuniformity,staticFilm.nonuniformity);
  assert.throws(()=>depositFilm('metal',{...metal,powerW:NaN}));assert.throws(()=>depositFilm('poly',{...poly,zoneSpreadC:30}));
});
test('P range table, dose scaling, oxide screening and anneal activation/diffusion trends',()=>{
  const a=implantPhosphorus({energyKeV:50,doseCm2:1e15},14,200),b=implantPhosphorus({energyKeV:100,doseCm2:1e15},14,200),dose=implantPhosphorus({energyKeV:50,doseCm2:2e15},14,200),blocked=implantPhosphorus({energyKeV:50,doseCm2:1e15},300,200);
  assert.equal(a.rpNm,60.7);assert.ok(b.rpNm>a.rpNm);assert.equal(dose.effectiveDoseCm2,2*a.effectiveDoseCm2);assert.ok(blocked.transmission<a.transmission);
  const r=annealImplant(a,{temperatureC:1000,seconds:30}),cold=annealImplant(a,{temperatureC:900,seconds:5}),hot=annealImplant(a,{temperatureC:1100,seconds:120});
  assert.ok(r.pass);assert.ok(cold.activation<r.activation);assert.ok(cold.sheetOhm>r.sheetOhm);assert.ok(hot.sigmaNm>r.sigmaNm);assert.ok(hot.junctionNm>r.junctionNm);assert.equal(r.profile.length,31);
});
test('all JSON stages 0-11 complete using real execute/measure/sign gates and no defect acknowledgement',()=>{
  assert.deepEqual(flow.stages.map(s=>s.number),Array.from({length:12},(_,i)=>i));
  const ids=operations(flow).map(t=>t.operation.id);assert.equal(new Set(ids).size,ids.length);
  const equipmentIds=new Set(map.equipment.map(e=>e.id));for(const {operation:op} of operations(flow)){assert.ok(equipmentIds.has(op.equipmentId));if(op.measurementRequired)assert.ok(equipmentIds.has(op.measurementEquipmentId));}
  const {state}=playThrough();assert.equal(currentTask(state,flow),null);assert.equal(state.prNm,0);assert.equal(state.photo,null);assert.equal(state.records.length,ids.length);
  assert.ok(state.records.filter(r=>r.measurement).every(r=>r.measurement.pass));
  assert.equal(state.films.poly.meanNm,200);assert.equal(state.films.ild.meanNm,500);assert.equal(state.films.metal.meanNm,500);assert.ok(state.anneal.pass);assert.ok(state.contacts.pass);assert.equal(state.screenOxideNm,0);assert.ok(state.gateOxideNm>14);
});
test('new operations cannot skip metrology or use a wrong equipment',()=>{
  let s=playThrough({untilStage:5}).state;assert.equal(currentTask(s,flow).operation.id,'poly-deposition');
  assert.throws(()=>applyAction(s,flow,exec('furnace',poly)));s=applyAction(s,flow,exec('deposition',poly));assert.throws(()=>applyAction(s,flow,sign));
  assert.throws(()=>applyAction(s,flow,exec('deposition',poly)));s=applyAction(s,flow,measure);s=applyAction(s,flow,sign);assert.equal(currentTask(s,flow).stage.number,6);
});
test('gate, contact and metal photo rework only invalidates its own mask and preserves earlier films',()=>{
  for(const group of ['gate','contact','metal']){
    const opIndex=operations(flow).findIndex(t=>t.operation.photoGroup===group&&t.operation.modelId==='develop');
    let s=playThrough({untilStage:group==='gate'?6:group==='contact'?8:10}).state;
    for(let guard=0;s.cursor<opIndex;guard++){
      assert.ok(guard<12);const op=currentTask(s,flow).operation,r=latestRecord(s,flow);
      s=applyAction(s,flow,!r?exec(op.equipmentId,defaultInput(s,op)):!r.measurement?measure:sign);
    }
    s=applyAction(s,flow,exec('coater',{seconds:60}));const before=structuredClone(s.films),field=s.fieldOxideNm;
    s=applyAction(s,flow,{type:'restart-photo',equipmentId:'coater'});assert.equal(currentTask(s,flow).operation.photoGroup,group);assert.equal(currentTask(s,flow).operation.modelId,'hmds');assert.equal(s.fieldOxideNm,field);assert.deepEqual(s.films,before);assert.ok(s.records.filter(r=>r.photoGroup===group).every(r=>r.superseded));assert.ok(s.records.find(r=>r.operationId==='active-hmds'&&!r.superseded));
  }
});
test('deposition nonuniformity affects residual etch at five sites, not just the mean',()=>{
  let s=playThrough({untilStage:5}).state;
  s=applyAction(s,flow,exec('deposition',{...poly,zoneSpreadC:15}));s=applyAction(s,flow,measure);assert.equal(latestRecord(s,flow).measurement.pass,false);
  assert.throws(()=>applyAction(s,flow,sign));s=applyAction(s,flow,{...sign,acknowledgeDefects:true});
  const etchIndex=operations(flow).findIndex(t=>t.operation.id==='gate-poly-etch');
  while(s.cursor<etchIndex){const op=currentTask(s,flow).operation,r=latestRecord(s,flow);s=applyAction(s,flow,!r?exec(op.equipmentId,defaultInput(s,op)):!r.measurement?measure:sign);}
  // Mean thickness 200 nm / 100 nm/min would appear cleared; the thickest site remains.
  s=applyAction(s,flow,exec('etcher',{minutes:2}));assert.ok(s.etch.maxResidualNm>5);assert.equal(s.etch.status,'미식각');
  s=applyAction(s,flow,measure);s=applyAction(s,flow,exec('etcher',{minutes:recommendedPatternEtchMinutes(s,currentTask(s,flow).operation)}));assert.equal(s.etch.maxResidualNm,0);assert.equal(latestRecord(s,flow).measurement,null);
});
test('bad contact or Al rotation remains visible after later steps and is not silently reset',()=>{
  const {state}=playThrough({override:op=>op.id==='al-deposition'?{rotation:'off'}:null,acknowledge:true});
  const record=state.records.find(r=>r.operationId==='al-deposition');assert.equal(record.measurement.pass,false);assert.ok(record.signature.acknowledgedDefects);assert.ok(state.films.metal.nonuniformity>.1);assert.equal(state.prNm,0);
  const failed=playThrough({override:op=>op.id==='contact-etch'?{minutes:1}:null,acknowledge:true}).state;
  assert.equal(failed.contacts.pass,false);assert.equal(failed.records.find(r=>r.operationId==='al-deposition').measurement.pass,false);
});
test('full event log replays and legacy stage-three completion resumes at stage four',()=>{
  let value=null;const provider=()=>({getItem:()=>value,setItem:(k,v)=>value=v});let persistence=createPersistence(provider,flow);
  const prefix=playThrough({untilStage:4});for(const action of prefix.events)persistence.record(action,'2026-11-19T12:00:00Z');let restored=createPersistence(provider,flow).load();assert.equal(currentTask(restored.state,flow).stage.number,4);assert.equal(restored.notice,null);
  persistence=createPersistence(provider,flow);persistence.reset();const complete=playThrough();for(const action of complete.events)persistence.record(action,'2026-11-19T12:00:00Z');restored=createPersistence(provider,flow).load();assert.equal(currentTask(restored.state,flow),null);assert.deepEqual(restored.state,complete.state);
});
