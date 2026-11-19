import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import {applyAction,createLot,currentTask} from '../src/systems/runsheet.js';
import {experimentRow,toCsv,summarize,EXPERIMENT_COLUMNS} from '../src/systems/experiment.js';
import {buildEvidencePacket,ruleBasedMeeting} from '../src/systems/advisor.js';
import {playThrough,defaultInput} from './flowHelpers.js';
const go=(s,a,at='2026-11-19T12:00:00Z')=>applyAction(s,flow,a,at);
function run(mode,cause,diagnosis){
  let s=go(createLot(),{type:'start-incident',cause,mode,participant:'  P01  '});s=playThrough({untilStage:1,initial:s}).state;
  s=go(s,{type:'execute',equipmentId:'furnace',input:defaultInput(s,currentTask(s,flow).operation)});
  s=go(go(s,{type:'measure',equipmentId:'metrology'},'2026-11-19T12:00:00Z'),{type:'incident-hold'});
  if(mode==='ai')s=go(s,{type:'incident-meeting',source:'rules',...ruleBasedMeeting(buildEvidencePacket(s))});
  else assert.throws(()=>go(s,{type:'incident-meeting',source:'rules',...ruleBasedMeeting(buildEvidencePacket(s))}),/실험/);
  return go(s,{type:'incident-diagnose',cause:diagnosis,disposition:'use-as-is'},'2026-11-19T12:03:30Z');
}
test('no-AI mode blocks meetings; rows capture mode, participant code, accuracy and wall time',()=>{
  const a=experimentRow(run('ai','overrun','overrun')),b=experimentRow(run('no-ai','local','bias'));
  assert.equal(a.participant,'P01');assert.equal(a.mode,'ai');assert.equal(a.meetings,1);assert.equal(a.causeOk,true);assert.equal(a.wallSeconds,210);
  assert.equal(b.mode,'no-ai');assert.equal(b.meetings,0);assert.equal(b.causeOk,false);
  assert.equal(experimentRow(createLot()),null);
  const csv=toCsv([a,b]).split('\n');assert.equal(csv[0],EXPERIMENT_COLUMNS.join(','));assert.equal(csv.length,3);
  assert.equal(toCsv([{...a,participant:'P,"1"'}]).split('\n')[1].split(',')[0],'"P');
  const s=summarize([a,b]);assert.equal(s.ai.n,1);assert.equal(s.ai.accuracy,1);assert.equal(s.noAi.accuracy,0);
});
