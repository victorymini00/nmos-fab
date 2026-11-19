import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {PHOTO as P} from '../src/constants.js';
import {coatResist,alignmentResult,developResist} from '../src/systems/lithography.js';
import {createLot,applyAction,currentTask,latestRecord,recommendedEtchMinutes} from '../src/systems/runsheet.js';
import {createPersistence} from '../src/systems/storage.js';
const execute=(equipmentId,input={})=>({type:'execute',equipmentId,input});
const measure={type:'measure',equipmentId:'metrology'};
const sign=(equipmentId='metrology',acknowledgeDefects=false)=>({type:'sign',equipmentId,name:'Photo Engineer',acknowledgeDefects});
const prefix=[execute('etcher'),sign('etcher'),execute('furnace',{temperatureC:1000,timeMinutes:60,ambient:'wet'}),measure,sign()];
function run(events,initial=createLot()){return events.reduce((s,a)=>applyAction(s,flow,a),initial);}
function patterned({hmds='apply',rpm=3000,dose=100,seconds=60,offsetXUm=0}={}){
  return run([...prefix,execute('coater',{treatment:hmds}),execute('coater',{rpm}),execute('aligner',{dose,offsetXUm,offsetYUm:0,rotationDeg:0}),execute('coater',{seconds})]);
}
function etchReady(options){let s=patterned(options);s=run([measure,sign('metrology',!s.photo.developed.pass)],s);return s;}
test('spin speed inverse-square-root law and alignment translation/rotation penalties',()=>{
  assert.equal(coatResist(3000),1500);assert.ok(Math.abs(coatResist(6000)-1500/Math.sqrt(2))<1e-9);
  const a=alignmentResult({offsetXUm:0,offsetYUm:0,rotationDeg:0});assert.equal(a.overlayUm,0);assert.ok(a.alignmentPass);
  assert.equal(alignmentResult({offsetXUm:3,offsetYUm:4,rotationDeg:0}).overlayUm,5);
  assert.ok(alignmentResult({offsetXUm:0,offsetYUm:0,rotationDeg:5}).overlayUm>1);
  assert.throws(()=>coatResist(NaN));assert.throws(()=>alignmentResult({offsetXUm:99,offsetYUm:0,rotationDeg:0}));
});
test('positive resist clears exposed area; low dose/short development leave PR scum',()=>{
  const base={prNm:1500,dose:100,seconds:60,hmds:true,alignment:alignmentResult({offsetXUm:0,offsetYUm:0,rotationDeg:0})};
  const nominal=developResist(base);assert.equal(nominal.openingPrNm,0);assert.ok(nominal.protectedPrNm>1400);assert.ok(nominal.pass);
  assert.ok(developResist({...base,dose:30}).openingPrNm>0);assert.ok(developResist({...base,seconds:20}).openingPrNm>0);
  assert.ok(developResist({...base,dose:300}).protectedPrNm<nominal.protectedPrNm);
});
test('full photo and BOE sequence enforces equipment, inspections and final signature',()=>{
  let s=run(prefix);assert.equal(currentTask(s,flow).operation.modelId,'hmds');
  assert.throws(()=>applyAction(s,flow,execute('aligner',{dose:100,offsetXUm:0,offsetYUm:0,rotationDeg:0})));
  s=patterned();assert.throws(()=>applyAction(s,flow,sign()));s=run([measure,sign()],s);
  assert.equal(currentTask(s,flow).operation.modelId,'boe');
  s=run([execute('etcher',{minutes:recommendedEtchMinutes(s)})],s);
  assert.equal(s.activeOxideNm,0);assert.ok(s.fieldOxideNm>370);assert.equal(s.etch.status,'정상');assert.ok(s.etch.pass);
  assert.throws(()=>applyAction(s,flow,sign()));s=run([measure,sign()],s);assert.equal(currentTask(s,flow).stage.number,4);
});
test('skipped HMDS survives development, BOE and signed defect acknowledgement',()=>{
  const good=etchReady(),bad=etchReady({hmds:'skip'});
  const g=run([execute('etcher',{minutes:recommendedEtchMinutes(good)})],good);
  const b=run([execute('etcher',{minutes:recommendedEtchMinutes(bad)}),measure],bad);
  assert.equal(g.etch.defectFraction,0);assert.ok(b.etch.defectFraction>.1);assert.equal(b.etch.defectOxideNm,0);assert.equal(b.etch.pass,false);
  assert.throws(()=>applyAction(b,flow,sign()));const done=run([sign('metrology',true)],b);assert.equal(currentTask(done,flow).stage.number,4);assert.ok(done.records.at(-1).signature.acknowledgedDefects);
});
test('alignment error propagates through inspection and etch',()=>{
  let s=etchReady({offsetXUm:4});s=run([execute('etcher',{minutes:recommendedEtchMinutes(s)}),measure],s);
  assert.equal(s.photo.alignment.alignmentPass,false);assert.equal(s.etch.pass,false);assert.equal(s.activeOxideNm,0);
});
test('BOE underetch, incremental reetch, overetch, and PR scum change physical results',()=>{
  const ready=etchReady();let under=run([execute('etcher',{minutes:2}),measure],ready);
  assert.equal(under.etch.status,'미식각');assert.ok(under.activeOxideNm>200);
  assert.throws(()=>applyAction(under,flow,sign()));
  const clear=run([execute('etcher',{minutes:recommendedEtchMinutes(ready)-2})],under);
  assert.equal(clear.etch.status,'정상');assert.equal(clear.activeOxideNm,0);assert.ok(clear.penaltyPoints>=P.reworkPenalty);assert.equal(latestRecord(clear,flow).measurement,null);
  const over=run([execute('etcher',{minutes:10})],ready);assert.equal(over.etch.status,'과식각');assert.ok(over.etch.undercutNm>clear.etch.undercutNm);
  const scum=etchReady({dose:20});const blocked=run([execute('etcher',{minutes:5.16})],scum);assert.ok(blocked.activeOxideNm>370);
});
test('photo rework preserves oxide, records penalty/history, requires full new sequence',()=>{
  const old=patterned({hmds:'skip'}),s=run([{type:'restart-photo',equipmentId:'coater'}],old);
  assert.equal(s.photo,null);assert.equal(s.prNm,0);assert.equal(s.fieldOxideNm,old.fieldOxideNm);assert.equal(s.cursor,2);assert.equal(s.penaltyPoints,P.reworkPenalty);assert.ok(s.records.filter(r=>r.stageNumber===2&&r.operationId!=='photo-rework').every(r=>r.superseded));
  const restarted=run([execute('coater',{treatment:'apply'})],s);assert.equal(restarted.photo.hmds,true);assert.equal(currentTask(restarted,flow).operation.modelId,'spin');
  const etched=run([execute('etcher',{minutes:5.16})],etchReady());assert.throws(()=>applyAction(etched,flow,{type:'restart-photo',equipmentId:'coater'}));
});
test('stage-two saves resume at HMDS and completed stage-three command logs replay exactly',()=>{
  let value=null;const storage=()=>({getItem:()=>value,setItem:(k,v)=>value=v});const p=createPersistence(storage,flow);
  const all=[...prefix,execute('coater',{treatment:'apply'}),execute('coater',{rpm:3000}),execute('aligner',{dose:100,offsetXUm:0,offsetYUm:0,rotationDeg:0}),execute('coater',{seconds:60}),measure,sign(),execute('etcher',{minutes:5.16}),measure,sign()];
  for(const a of prefix)p.record(a,'2026-11-19T10:00:00Z');assert.equal(createPersistence(storage,flow).load().state.cursor,2);
  for(const a of all.slice(prefix.length))p.record(a,'2026-11-19T10:01:00Z');const restored=createPersistence(storage,flow).load();assert.equal(restored.notice,null);assert.equal(currentTask(restored.state,flow).stage.number,4);assert.equal(restored.state.activeOxideNm,0);
});

