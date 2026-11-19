import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {applyAction,createLot,currentTask} from '../src/systems/runsheet.js';
import {buildEvidencePacket,ruleBasedMeeting,sanitizeMeeting,callClaude,SYSTEM_PROMPT} from '../src/systems/advisor.js';
import {createPersistence} from '../src/systems/storage.js';
import {playThrough,defaultInput} from './flowHelpers.js';
const at='2026-11-19T12:00:00Z',go=(s,a)=>applyAction(s,flow,a,at),measure={type:'measure',equipmentId:'metrology'};
function held(cause){let s=go(createLot(),{type:'start-incident',cause});s=playThrough({untilStage:1,initial:s}).state;
  s=go(s,{type:'execute',equipmentId:'furnace',input:defaultInput(s,currentTask(s,flow).operation)});return go(go(s,measure),{type:'incident-hold'});}
const withAll=s=>go(go(go(s,{type:'check-reference',equipmentId:'metrology'}),{type:'inspect-log',equipmentId:'furnace'}),measure);
test('evidence packet never leaks the hidden cause or hidden tool state',()=>{
  for(const cause of ['bias','overrun','local']){
    const text=JSON.stringify(buildEvidencePacket(withAll(held(cause)),'원인이 뭘까?'));
    for(const secret of ['"cause"','hidden','siteFactors','biasNm','trueNm','bias','overrun','"local"','계측기 편향','산화로 과성장','국부 두께 이상'])assert.ok(!text.includes(secret),`${cause}: ${secret}`);
  }
  const before=['bias','overrun'].map(c=>Object.keys(buildEvidencePacket(held(c))).join());assert.equal(before[0],before[1]);
});
test('rule-based meeting withholds judgment without evidence and points to the right cause once evidence exists',()=>{
  const none=ruleBasedMeeting(buildEvidencePacket(held('bias')));assert.ok(none.opinions.every(o=>o.confidence==='low'));
  const high=c=>ruleBasedMeeting(buildEvidencePacket(withAll(held(c)))).opinions.filter(o=>o.confidence==='high').map(o=>o.role).sort().join();
  assert.equal(high('bias'),'MET');assert.equal(high('overrun'),'EE,PE');assert.equal(high('local'),'');
  const local=ruleBasedMeeting(buildEvidencePacket(withAll(held('local'))));assert.match(local.opinions[0].hypothesis,/남/);
});
test('AI output is sanitized: invented evidence ids are removed and their confidence downgraded',()=>{
  const p=buildEvidencePacket(withAll(held('bias'))),raw=`설명 {"opinions":[{"role":"PE","hypothesis":"x","basis":["M1","Z9"],"next":"y","confidence":"high"},{"role":"EE","hypothesis":"x","basis":["Z1"],"next":"y","confidence":"high"},{"role":"MET","hypothesis":"x","basis":["R1"],"next":"y","confidence":"medium"}],"summary":"s"} 끝`;
  const m=sanitizeMeeting(raw,p);assert.deepEqual(m.opinions[0].basis,['M1']);assert.deepEqual(m.opinions[0].inventedBasis,['Z9']);assert.equal(m.opinions[1].confidence,'low');
  assert.throws(()=>sanitizeMeeting('JSON 없음',p));assert.throws(()=>sanitizeMeeting('{"opinions":[]}',p));
});
test('Claude call sends the key only in headers with the browser-access flag; API errors surface',async()=>{
  const p=buildEvidencePacket(held('bias'));let seen;
  const ok=async(url,init)=>{seen={url,init};return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({opinions:['PE','EE','MET'].map(role=>({role,hypothesis:'h',basis:[],next:'n',confidence:'low'})),summary:'s'})}]})};};
  const m=await callClaude(p,{apiKey:'sk-test',fetchFn:ok});assert.equal(m.opinions.length,3);
  assert.equal(seen.init.headers['x-api-key'],'sk-test');assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'],'true');
  const body=JSON.parse(seen.init.body);assert.equal(body.system,SYSTEM_PROMPT);assert.ok(!seen.init.body.includes('sk-test'));
  await assert.rejects(callClaude(p,{apiKey:'bad',fetchFn:async()=>({ok:false,status:401,json:async()=>({error:{message:'invalid x-api-key'}})})}),/invalid/);
});
test('meetings are recorded in state, cost time, only during HOLD, count in evaluation, and replay without re-calling AI',()=>{
  let s=held('overrun');const m=ruleBasedMeeting(buildEvidencePacket(s));const action={type:'incident-meeting',source:'rules',...m};
  assert.throws(()=>go(playThrough({untilStage:1}).state,action));
  const before=s.incident.minutes;s=go(s,action);assert.equal(s.incident.meetings.length,1);assert.equal(s.incident.minutes,before+5);
  s=go(s,{type:'incident-diagnose',cause:'overrun',disposition:'use-as-is'});assert.equal(s.incident.evaluation.meetings,1);
  let value=null;const store=()=>({getItem:()=>value,setItem:(k,v)=>value=v}),p=createPersistence(store,flow);
  let t=go(createLot(),{type:'start-incident',cause:'bias'});p.record({type:'start-incident',cause:'bias'},at);
  assert.deepEqual(createPersistence(store,flow).load().state,t);
});
import {callGemini,listGeminiModels} from '../src/systems/advisor.js';
test('Gemini call: key only in header, system prompt + JSON mode, parses candidate text, skips thought parts',async()=>{
  const p=buildEvidencePacket(held('overrun'));let seen;
  const reply=JSON.stringify({opinions:['PE','EE','MET'].map(role=>({role,hypothesis:'h',basis:['M1'],next:'n',confidence:'medium'})),summary:'s'});
  const ok=async(url,init)=>{seen={url,init};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'생각 중',thought:true},{text:reply}]},finishReason:'STOP'}]})};};
  const m=await callGemini(p,{apiKey:'AIza-test',model:'models/gemini-test-flash',fetchFn:ok});
  assert.equal(m.opinions[0].basis[0],'M1');assert.match(seen.url,/\/models\/gemini-test-flash:generateContent$/);
  assert.equal(seen.init.headers['x-goog-api-key'],'AIza-test');assert.ok(!seen.url.includes('AIza')&&!seen.init.body.includes('AIza'));
  const body=JSON.parse(seen.init.body);assert.equal(body.systemInstruction.parts[0].text,SYSTEM_PROMPT);assert.equal(body.generationConfig.responseMimeType,'application/json');
  await assert.rejects(callGemini(p,{apiKey:'x',model:'bad/../name',fetchFn:ok}),/모델 이름/);
  await assert.rejects(callGemini(p,{apiKey:'x',fetchFn:async()=>({ok:false,status:429,json:async()=>({error:{message:'quota exceeded'}})})}),/quota/);
  await assert.rejects(callGemini(p,{apiKey:'x',fetchFn:async()=>({ok:true,json:async()=>({promptFeedback:{blockReason:'SAFETY'}})})}),/SAFETY/);
});
test('Gemini model list keeps generateContent models, follows pages, flash first',async()=>{
  const pages=[{models:[{name:'models/embed-1',supportedGenerationMethods:['embedContent']},{name:'models/gemini-x-pro',supportedGenerationMethods:['generateContent']}],nextPageToken:'p2'},{models:[{name:'models/gemini-x-flash',supportedGenerationMethods:['generateContent']}]}];
  let i=0;const list=await listGeminiModels('k',async()=>({ok:true,json:async()=>pages[i++]}));
  assert.deepEqual(list,['gemini-x-flash','gemini-x-pro']);
});
