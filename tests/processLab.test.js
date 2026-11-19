import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import LAB from '../src/data/process_lab.json' with {type:'json'};
import * as L from '../src/systems/processLab.js';
import {playThrough} from './flowHelpers.js';
const at='2026-11-19T12:00:00Z',pred={meanNm:200,nonuniformityPct:2,reason:'온도 영향 확인'};
const done=playThrough().state;
const session=()=>L.startSession(L.saveBaseline(L.createLab(),done,flow,at),'B1','2026-11-19T12:05:00Z');
const run=(lab,input,sites)=>L.runExperiment(lab,{input,sites,prediction:pred},at);
test('baseline needs a completed run, is a read-only copy, and never mutates the lot',()=>{
  assert.throws(()=>L.saveBaseline(L.createLab(),playThrough({untilStage:6}).state,flow,at),/완료된 Run/);
  const before=JSON.stringify(done);let lab=L.saveBaseline(L.createLab(),done,flow,at);
  assert.equal(JSON.stringify(done),before);assert.deepEqual(lab.baselines[0].recipe,{temperatureC:620,minutes:20,zoneSpreadC:1});
  assert.throws(()=>L.saveBaseline(lab,done,flow,at),/이미/);
  lab=L.startSession(lab,'B1',at);lab=run(lab,{temperatureC:650,minutes:10,zoneSpreadC:0});
  assert.equal(JSON.stringify(done),before);assert.equal(lab.baselines[0].recipe.temperatureC,620);
  assert.deepEqual(lab.session.preLpcvd,lab.baselines[0].preLpcvd);assert.notEqual(lab.session.preLpcvd,lab.baselines[0].preLpcvd);
});
test('changed variables are tracked against the previous run; inputs validated by data limits',()=>{
  let lab=run(session(),{temperatureC:640,minutes:20,zoneSpreadC:1});assert.deepEqual(lab.session.runs[0].changed,['temperatureC']);assert.equal(lab.session.runs[0].changedFrom,'기준 Run');
  lab=run(lab,{temperatureC:640,minutes:13,zoneSpreadC:0});assert.deepEqual(lab.session.runs[1].changed,['minutes','zoneSpreadC']);
  assert.throws(()=>run(lab,{temperatureC:700,minutes:10,zoneSpreadC:0}),/580~650/);
  assert.throws(()=>L.runExperiment(lab,{input:{temperatureC:620,minutes:20,zoneSpreadC:1},prediction:{meanNm:200,nonuniformityPct:2,reason:'짧'}},at),/이유/);
});
test('at most 6 experiments per session; each records input, sites, values, observed uniformity and process time',()=>{
  let lab=session();for(let i=0;i<6;i++)lab=run(lab,{temperatureC:620,minutes:20,zoneSpreadC:1});
  assert.throws(()=>run(lab,{temperatureC:620,minutes:20,zoneSpreadC:1}),/최대 6/);
  const r=lab.session.runs[0];assert.equal(r.measurement.observed.length,5);assert.ok(r.measurement.observed.every(o=>Number.isFinite(o.valueNm)));
  assert.equal(r.processMinutes,20+LAB.processTime.fixedOverheadMinutes+LAB.processTime.stabilizationMinutesPerC*(LAB.processTime.stabilizationReferenceSpreadC-1));
  assert.deepEqual(r.prediction,pred);
});
test('partial measurement never confirms whole-wafer uniformity or the goal',()=>{
  const lab=run(session(),{temperatureC:620,minutes:20,zoneSpreadC:1},['중앙','동']),r=lab.session.runs[0];
  assert.equal(r.goal.uniformityStatus,'partial');assert.equal(r.goal.status,'insufficient');assert.equal(r.goal.uniformityOk,null);
  assert.throws(()=>L.selectBest(lab,1),/5지점/);
  const one=run(session(),{temperatureC:620,minutes:20,zoneSpreadC:1},['중앙']).session.runs[0];assert.equal(one.goal.uniformityStatus,'unknown');assert.equal(one.measurement.nonuniformity,null);
});
test('process draw is fixed by run index and independent of measurement choice; measurement error is separate',()=>{
  const a=run(session(),{temperatureC:640,minutes:13,zoneSpreadC:0},['중앙']).session.runs[0],b=run(session(),{temperatureC:640,minutes:13,zoneSpreadC:0}).session.runs[0];
  assert.deepEqual(a.hidden.draw,b.hidden.draw);assert.deepEqual(a.hidden.trueResult,b.hidden.trueResult);
  assert.notEqual(b.measurement.observed[0].valueNm,b.hidden.trueResult.values[0]);
  const lab=run(run(session(),{temperatureC:620,minutes:20,zoneSpreadC:1}),{temperatureC:620,minutes:20,zoneSpreadC:1});
  assert.notDeepEqual(lab.session.runs[0].hidden.draw,lab.session.runs[1].hidden.draw);
});
test('truth is hidden until the session ends; reveal then exposes true values and run draws',()=>{
  let lab=run(session(),{temperatureC:620,minutes:20,zoneSpreadC:1});
  assert.ok(!('hidden' in L.publicRun(lab.session.runs[0])));assert.throws(()=>L.reveal(lab.session),/종료/);
  assert.ok(!L.labCsv(lab.session).split('\n')[1].match(/,\d+\.\d{2},\d+\.\d{3},\d\.\d{4}$/));
  lab=L.endSession(lab,at);const rv=L.reveal(lab.session)[0];assert.ok(Number.isFinite(rv.trueMeanNm)&&Number.isFinite(rv.rateFactor));
  assert.throws(()=>run(lab,{temperatureC:620,minutes:20,zoneSpreadC:1}),/세션/);
});
test('goal is data-driven: tighter limits change the verdict',()=>{
  const r=run(session(),{temperatureC:620,minutes:20,zoneSpreadC:1}).session.runs[0];
  assert.equal(L.evaluateGoal(r.measurement,{...LAB.goal,maxNonuniformityPct:.1}).status,'fail');
  assert.equal(L.evaluateGoal(r.measurement,{...LAB.goal,maxNonuniformityPct:50,thicknessTolerancePct:50}).status,'met');
});
test('best pick requires a met 5-site run; confirmation is a new run of the same recipe with full measurement',()=>{
  let lab=run(session(),{temperatureC:650,minutes:10.6,zoneSpreadC:0});assert.equal(lab.session.runs[0].goal.status,'met');
  assert.throws(()=>L.runConfirmation(lab,at),/먼저/);
  lab=L.selectBest(lab,1);lab=L.runConfirmation(lab,at);const c=lab.session.confirmation;
  assert.deepEqual(c.input,lab.session.runs[0].input);assert.equal(c.measurement.observed.length,5);assert.notDeepEqual(c.hidden.draw,lab.session.runs[0].hidden.draw);
  assert.equal(typeof c.reproduced,'boolean');assert.throws(()=>L.runConfirmation(lab,at),/이미/);
});
test('CSV exports comparison + intent; true values only after the session ends',()=>{
  let lab=run(session(),{temperatureC:640,minutes:20,zoneSpreadC:1});lab=L.selectBest(run(lab,{temperatureC:650,minutes:10.6,zoneSpreadC:0}),2);lab=L.runConfirmation(lab,at);
  let csv=L.labCsv(lab.session).split('\n');assert.equal(csv[0],L.CSV_COLUMNS.join(','));assert.equal(csv.length,4);
  const col=name=>L.CSV_COLUMNS.indexOf(name),row=csv[1].split(',');
  assert.equal(row[col('intentReason')],'온도 영향 확인');assert.equal(row[col('changedVariables')],'temperatureC');assert.equal(row[col('trueMeanNm')],'');
  lab=L.endSession(lab,at);csv=L.labCsv(lab.session).split('\n');assert.ok(Number(csv[1].split(',')[col('trueMeanNm')])>0);assert.equal(csv[3].split(',')[col('kind')],'confirmation');
});
