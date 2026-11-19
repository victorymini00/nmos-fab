import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import map from '../src/data/map_layout.json' with {type:'json'};
import {thresholdVoltage,squareLaw,deviceParameters,simulateDevice,gradeDevice,processFeedback} from '../src/systems/electrical.js';
import {applyAction,currentTask,createLot} from '../src/systems/runsheet.js';
import {reportData,reportRows} from '../src/systems/report.js';
import {paginateRows,PAPER} from '../src/ui/reportExport.js';
import {createPersistence} from '../src/systems/storage.js';
import {playThrough} from './flowHelpers.js';
const op=flow.stages.at(-1).operations[0],conditions=op.testConditions,spec=op.specification;
test('MOS threshold uses oxide capacitance and p-substrate doping with consistent cm units',()=>{
  const a=thresholdVoltage(14.195152489785512,1e16,300),thick=thresholdVoltage(28.390304979571024,1e16,300),doped=thresholdVoltage(14.195152489785512,2e16,300);
  assert.ok(a.vtV>.9&&a.vtV<.95);assert.ok(thick.vtV>a.vtV);assert.ok(doped.vtV>a.vtV);assert.ok(Math.abs(a.coxFPerCm2/thick.coxFPerCm2-2)<1e-12);
  assert.throws(()=>thresholdVoltage(0,1e16,300));assert.equal(squareLaw(.5,1,1,1e-4),0);
  assert.ok(Math.abs(squareLaw(2,.2,1,1e-4)-1.8e-5)<1e-12);assert.equal(squareLaw(2,2,1,1e-4),.00005);
});
test('nominal full process reaches tester, generates monotone curve, S grade and reference agreement',()=>{
  let state=playThrough({untilStage:11}).state;assert.equal(currentTask(state,flow).operation.id,'final-electrical');
  assert.throws(()=>applyAction(state,flow,{type:'execute',equipmentId:'metrology'}));
  state=applyAction(state,flow,{type:'execute',equipmentId:'tester'});const r=state.electrical;
  assert.equal(r.grade,'S');assert.equal(r.score,100);assert.equal(r.curve.length,67);assert.equal(r.curve[0].idA,0);assert.ok(r.ionA>.0002&&r.ionA<.0005);
  assert.ok(Math.abs(r.ionA-r.reference.ionA)<1e-12);for(let i=1;i<r.curve.length;i++)assert.ok(r.curve[i].idA>=r.curve[i-1].idA);
  assert.throws(()=>reportData(state,flow,map));state=applyAction(state,flow,{type:'sign',equipmentId:'tester',name:'QA'});assert.equal(currentTask(state,flow),null);
  const report=reportData(state,flow,map);assert.equal(report.rows.length,state.records.length);assert.ok(report.rows.at(-1).cells[4].includes('S / 100점'));
});
test('S/D dose affects resistance and Ion, not channel substrate Vt',()=>{
  const normal=playThrough({untilStage:11}).state;
  const lowDose=playThrough({untilStage:11,override:p=>p.modelId==='implant'?{doseCm2:3e14}:null,acknowledge:true}).state;
  const a=simulateDevice(deviceParameters(normal),conditions),b=simulateDevice(deviceParameters(lowDose),conditions);
  assert.equal(a.vtV,b.vtV);assert.ok(b.resistanceOhm>a.resistanceOhm);assert.ok(b.ionA<a.ionA);
});
test('gate oxide perturbation produces interpretable strongest-group counterfactual feedback',()=>{
  const s=playThrough({untilStage:11}).state,p=deviceParameters(s),r=simulateDevice(p,conditions),bad=simulateDevice({...p,toxNm:p.toxNm*2},conditions);
  assert.ok(bad.vtV>r.vtV);assert.ok(bad.ionA<r.ionA);const f=processFeedback(bad,r,conditions);assert.equal(f[0].id,'oxide');assert.ok(f[0].deltaVtV<0);assert.ok(f[0].deltaIonA>0);
});
test('invalid contacts report F with no fabricated terminal current and require acknowledged final signature',()=>{
  let s=playThrough({untilStage:11,override:p=>p.id==='contact-etch'?{minutes:1}:null,acknowledge:true}).state;
  s=applyAction(s,flow,{type:'execute',equipmentId:'tester'});assert.equal(s.electrical.grade,'F');assert.equal(s.electrical.ionA,null);assert.ok(s.electrical.curve.every(p=>p.idA===null));assert.equal(s.electrical.feedback[0].id,'contact');
  assert.throws(()=>applyAction(s,flow,{type:'sign',equipmentId:'tester',name:'QA'}));s=applyAction(s,flow,{type:'sign',equipmentId:'tester',name:'QA',acknowledgeDefects:true});assert.equal(currentTask(s,flow),null);
});
test('grade bands incorporate spec deviations, process inspection failures and rework penalties',()=>{
  const s=playThrough({untilStage:11}).state,r=simulateDevice(deviceParameters(s),conditions);
  assert.equal(gradeDevice(r,r,s,spec).grade,'S');assert.equal(gradeDevice(r,r,{...s,penaltyPoints:20},spec).grade,'A');
  assert.equal(gradeDevice({...r,ionA:r.ionA*.75},r,s,spec).grade,'B');assert.equal(gradeDevice({...r,ionA:r.ionA*.4},r,s,spec).grade,'F');
});
test('report pagination retains every record and every line, including unusually long cells',()=>{
  const state=playThrough().state,rows=reportRows(state,flow,map),measure=t=>[...t].length*9;
  const pages=paginateRows(rows,measure);assert.ok(pages.length>1);assert.equal(pages.flat().length,rows.length);assert.deepEqual(new Set(pages.flat().map(r=>r.recordId)),new Set(rows.map(r=>r.recordId)));
  const long={recordId:999,cells:['기록',...Array.from({length:6},()=>Array(150).fill('가나다라마바사').join('\n'))]};
  const split=paginateRows([long],measure);assert.ok(split.length>1);assert.equal(split.flat().flatMap(r=>r.lineCells[1]).length,150);
  for(const page of [...pages,...split])assert.ok(page.reduce((sum,r)=>sum+r.height,0)<=PAPER.height-PAPER.bottom-PAPER.tableTop-PAPER.headerHeight);
});
test('completed electrical records and final signatures replay through the same storage gates',()=>{
  let value=null;const provider=()=>({getItem:()=>value,setItem:(k,v)=>value=v});const p=createPersistence(provider,flow),complete=playThrough();
  for(const action of complete.events)p.record(action,'2026-11-19T12:00:00Z');const restored=createPersistence(provider,flow).load();assert.equal(restored.notice,null);assert.deepEqual(restored.state,complete.state);
  assert.equal(createLot().electrical,null);
});
