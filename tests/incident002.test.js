import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {applyAction,createLot,currentTask,latestRecord} from '../src/systems/runsheet.js';
import {causeStatus} from '../src/systems/incident002.js';
import {buildEvidencePacket,ruleBasedMeeting,systemPromptFor,SYSTEM_PROMPT_002,callGemini} from '../src/systems/advisor.js';
import {experimentRow} from '../src/systems/experiment.js';
import {createPersistence} from '../src/systems/storage.js';
import {playThrough} from './flowHelpers.js';
const at='2026-11-19T12:00:00Z',go=(s,a,t=at)=>applyAction(s,flow,a,t);
const chk=kind=>({type:'incident2-check',equipmentId:'tester',check:kind});
function tested(cause,extra={}){
  let s=go(createLot(),{type:'start-incident',quest:'002',cause,...extra});
  s=playThrough({untilStage:11,initial:s}).state;
  return go(s,{type:'execute',equipmentId:'tester'});
}
const held=cause=>go(tested(cause),{type:'incident-hold'});
for(const cause of ['contact-residue','metal-open','probe-contact'])test(`${cause}: same OPEN symptom, no fabricated curve, model expectation kept separate`,()=>{
  const s=tested(cause),r=s.electrical;
  assert.equal(s.incident.phase,'alarm');assert.equal(r.measurementStatus,'open');assert.equal(r.ionA,null);assert.ok(r.curve.every(p=>p.idA===null));
  assert.ok(r.reference.ionA>1e-4);assert.equal(r.parameters.blockers.length,0);assert.equal(r.score,0);
  assert.throws(()=>go(s,{type:'sign',equipmentId:'tester',name:'QA',acknowledgeDefects:true}),/OPEN/);
});
test('cause is seeded at quest start and unaffected by check order or AI meetings',()=>{
  const a=go(createLot(),{type:'start-incident',quest:'002'},'2026-11-19T09:00:00Z'),b=go(createLot(),{type:'start-incident',quest:'002'},'2026-11-19T09:00:00Z');
  assert.equal(a.incident.cause,b.incident.cause);
  let x=held('metal-open'),y=held('metal-open');
  x=go(go(x,chk('probe-reseat')),chk('contact-chain'));y=go(go(y,{type:'incident-meeting',source:'rules',...ruleBasedMeeting(buildEvidencePacket(y))}),chk('contact-chain'));
  y=go(y,chk('probe-reseat'));assert.equal(x.incident.cause,y.incident.cause);
  assert.deepEqual(x.incident.checks.find(c=>c.kind==='contact-chain').result,y.incident.checks.find(c=>c.kind==='contact-chain').result);
});
test('each check confirms or rules out one cause; history alone decides nothing',()=>{
  const st=cause=>{let s=held(cause);for(const k of ['history','contact-chain','metal-continuity','probe-reseat'])s=go(s,chk(k));return causeStatus(s.incident);};
  assert.deepEqual(causeStatus(held('probe-contact').incident),{'contact-residue':'unverified','metal-open':'unverified','probe-contact':'unverified'});
  let h=go(held('contact-residue'),chk('history'));assert.ok(Object.values(causeStatus(h.incident)).every(v=>v==='unverified'));
  assert.deepEqual(st('contact-residue'),{'contact-residue':'confirmed','metal-open':'ruled-out','probe-contact':'ruled-out'});
  assert.deepEqual(st('metal-open'),{'contact-residue':'ruled-out','metal-open':'confirmed','probe-contact':'ruled-out'});
  assert.deepEqual(st('probe-contact'),{'contact-residue':'ruled-out','metal-open':'ruled-out','probe-contact':'confirmed'});
  const s=held('metal-open');const t=go(go(s,chk('history')),chk('contact-chain'));assert.equal(t.incident.minutes,5+15);
});
test('probe re-seat changes only the test contact: device model values are untouched; real opens stay open',()=>{
  let s=held('probe-contact');const before=JSON.stringify(s.electrical.reference);
  s=go(s,chk('probe-reseat'));assert.equal(s.incident.probeSeated,true);assert.equal(JSON.stringify(s.electrical.reference),before);
  assert.match(s.records.at(-1).result.reading,/측정됨/);
  let m=go(held('metal-open'),chk('probe-reseat'));assert.match(m.records.at(-1).result.reading,/OPEN/);
});
test('probe cause: diagnose → re-seat action → retest verifies with a real curve → close → sign',()=>{
  let s=go(held('probe-contact'),chk('probe-reseat'));
  s=go(s,{type:'incident-diagnose',cause:'probe-contact',disposition:'reseat-retest'});assert.equal(s.incident.phase,'action');
  assert.throws(()=>go(s,{type:'sign',equipmentId:'tester',name:'QA'}));
  assert.throws(()=>go(s,{type:'execute',equipmentId:'tester'}),/서명|실행/);
  s=go(s,{type:'incident2-act',equipmentId:'tester'});const penalty=s.penaltyPoints;
  s=go(s,{type:'execute',equipmentId:'tester'});assert.equal(s.incident.phase,'closed');assert.equal(s.electrical.measurementStatus,'measured');
  assert.ok(s.electrical.curve.at(-1).idA>1e-4);assert.equal(s.electrical.grade,'S');assert.equal(s.penaltyPoints,penalty);
  const e=s.incident.evaluation;assert.equal(e.causeOk,true);assert.equal(e.bestDisposition,true);assert.equal(e.keyEvidenceFound,true);assert.deepEqual(e.order,['probe-reseat']);assert.equal(e.score,100);
  s=go(s,{type:'sign',equipmentId:'tester',name:'QA'});assert.equal(currentTask(s,flow),null);
});
test('metal cut cannot be fixed by a button: re-seat retest stays OPEN, verification fails, scrap verified by continuity',()=>{
  let s=go(held('metal-open'),{type:'incident-diagnose',cause:'probe-contact',disposition:'reseat-retest'});
  s=go(go(s,{type:'incident2-act',equipmentId:'tester'}),{type:'execute',equipmentId:'tester'});
  assert.equal(s.incident.phase,'action');assert.equal(s.incident.verification.ok,false);assert.equal(s.electrical.measurementStatus,'open');
  s=go(s,{type:'incident-disposition',disposition:'scrap-metal'});s=go(s,{type:'incident2-act',equipmentId:'tester'});
  s=go(s,{type:'incident2-verify',equipmentId:'tester'});assert.equal(s.incident.phase,'closed');
  const e=s.incident.evaluation;assert.equal(e.causeOk,false);assert.equal(e.keyEvidenceFound,false);assert.ok(e.score<50);assert.deepEqual(e.order,['metal-continuity']);
  assert.throws(()=>go(s,{type:'sign',equipmentId:'tester',name:'QA'}));s=go(s,{type:'sign',equipmentId:'tester',name:'QA',acknowledgeDefects:true});
  assert.equal(s.electrical.grade,'F');
});
test('ship-as-is never verifies; checks after confirmation are counted as unnecessary',()=>{
  let s=held('contact-residue');for(const k of ['contact-chain','metal-continuity','probe-reseat','contact-chain'])s=go(s,chk(k));
  s=go(s,{type:'incident-diagnose',cause:'contact-residue',disposition:'ship-as-is'});s=go(s,{type:'incident2-act',equipmentId:'tester'});
  s=go(s,{type:'incident2-verify',equipmentId:'tester'});assert.equal(s.incident.phase,'action');assert.equal(s.incident.verification.ok,false);
  s=go(s,{type:'incident-disposition',disposition:'scrap-contact'});s=go(go(s,{type:'incident2-act',equipmentId:'tester'}),{type:'incident2-verify',equipmentId:'tester'});
  const e=s.incident.evaluation;assert.equal(e.unnecessaryChecks,3);assert.equal(e.causeOk,true);assert.equal(e.verificationAttempts,2);
  const row=experimentRow(s);assert.equal(row.quest,'INCIDENT-002');assert.equal(row.unnecessaryChecks,3);assert.equal(row.evidence,'contact-chain|metal-continuity|probe-reseat|contact-chain');
});
test('AI packet: no hidden cause, no unexecuted check results, no device truth; 002 prompt used',()=>{
  const secrets=['contact-residue','metal-open','probe-contact','"cause"','probeSeated','hidden','truth','Contact 식각 잔사','Metal 배선 단선','프로브 접촉 불량'];
  for(const cause of ['contact-residue','metal-open','probe-contact']){
    const before=buildEvidencePacket(held(cause));assert.deepEqual(before.evidence,[]);
    const text=JSON.stringify(buildEvidencePacket(go(held(cause),chk('contact-chain'))));for(const x of secrets)assert.ok(!text.includes(x),`${cause}:${x}`);
    assert.ok(!text.includes('배선 연속성')&&!text.includes('재접촉 후'));
  }
  assert.equal(systemPromptFor(buildEvidencePacket(held('metal-open'))),SYSTEM_PROMPT_002);
  const keys=['contact-residue','metal-open'].map(c=>JSON.stringify(Object.keys(buildEvidencePacket(held(c)))));assert.equal(keys[0],keys[1]);
});
test('rule-based meeting withholds judgment, then follows decisive evidence',()=>{
  const none=ruleBasedMeeting(buildEvidencePacket(held('metal-open')));assert.ok(none.opinions.every(o=>o.confidence==='low'));
  const m=ruleBasedMeeting(buildEvidencePacket(go(held('metal-open'),chk('metal-continuity'))));assert.equal(m.opinions.find(o=>o.role==='PE').confidence,'high');assert.match(m.opinions[0].hypothesis,/배선/);
});
test('Gemini call uses the 002 prompt for 002 packets',async()=>{
  let body;await callGemini(buildEvidencePacket(held('probe-contact')),{apiKey:'k',fetchFn:async(u,i)=>{body=JSON.parse(i.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({opinions:['PE','EE','MET'].map(role=>({role,hypothesis:'h',basis:[],next:'n',confidence:'low'})),summary:''})}]}}]})};}});
  assert.equal(body.systemInstruction.parts[0].text,SYSTEM_PROMPT_002);
});
test('INCIDENT 001 hooks ignore 002 lots; storage replay reproduces the whole 002 flow',()=>{
  let s=go(createLot(),{type:'start-incident',quest:'002',cause:'probe-contact'});const actions=[{type:'start-incident',quest:'002',cause:'probe-contact'}];
  const done=playThrough({untilStage:11,initial:s});assert.equal(done.state.incident.phase,'armed');
  let value=null;const store=()=>({getItem:()=>value,setItem:(k,v)=>value=v}),p=createPersistence(store,flow);
  for(const a of [...actions,...done.events])p.record(a,at);
  let t=done.state;for(const a of [{type:'execute',equipmentId:'tester'},{type:'incident-hold'},chk('probe-reseat'),{type:'incident-diagnose',cause:'probe-contact',disposition:'reseat-retest'},{type:'incident2-act',equipmentId:'tester'},{type:'execute',equipmentId:'tester'}]){t=go(t,a);p.record(a,at);}
  assert.equal(t.incident.phase,'closed');assert.deepEqual(createPersistence(store,flow).load().state,t);
});
