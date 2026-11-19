import {test} from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/data/process_flow.json' with {type:'json'};
import layout from '../src/data/map_layout.json' with {type:'json'};
import {applyAction,createLot,nextEquipment} from '../src/systems/runsheet.js';
import {equipmentStatuses} from '../src/systems/equipmentStatus.js';
import {createPerfMonitor} from '../src/world/perf.js';
import {playThrough} from './flowHelpers.js';
const ids=layout.equipment.map(e=>e.id),at='2026-11-19T12:00:00Z';
test('new lot marks only the first tool as next, everything else idle',()=>{
  const s=createLot(),m=equipmentStatuses(s,flow,ids);
  assert.equal(m[nextEquipment(s,flow)],'next');assert.equal(Object.values(m).filter(v=>v!=='idle').length,1);
});
test('executed oxidation blinks furnace as running while metrology becomes next; signing clears it',()=>{
  let s=playThrough({untilStage:1}).state;
  s=applyAction(s,flow,{type:'execute',equipmentId:'furnace',input:{ambient:'wet',temperatureC:1000,timeMinutes:60}},at);
  let m=equipmentStatuses(s,flow,ids);assert.equal(m.furnace,'running');assert.equal(m.metrology,'next');
  s=applyAction(s,flow,{type:'measure',equipmentId:'metrology'},at);m=equipmentStatuses(s,flow,ids);assert.equal(m.furnace,'running');
  s=applyAction(s,flow,{type:'sign',equipmentId:'metrology',name:'QA'},at);m=equipmentStatuses(s,flow,ids);assert.equal(m.furnace,'idle');
});
test('failed inspection turns the process tool red (fault)',()=>{
  let s=playThrough({untilStage:1}).state;
  s=applyAction(s,flow,{type:'execute',equipmentId:'furnace',input:{ambient:'wet',temperatureC:1000,timeMinutes:10}},at);
  s=applyAction(s,flow,{type:'measure',equipmentId:'metrology'},at);
  assert.equal(equipmentStatuses(s,flow,ids).furnace,'fault');
});
test('completed lot leaves every tool idle',()=>{
  const s=playThrough().state;assert.ok(Object.values(equipmentStatuses(s,flow,ids)).every(v=>v==='idle'));
});
test('perf monitor ignores warmup, trips once after sustained slow frames, never on fast frames',()=>{
  const cfg={warmup:1,limit:1/32,hold:2,smoothing:.2};
  const fast=createPerfMonitor(cfg);for(let i=0;i<600;i++)assert.equal(fast.sample(1/60),false);
  const slow=createPerfMonitor(cfg);let trips=0,time=0;for(let i=0;i<400;i++){time+=1/15;if(slow.sample(1/15))trips++;}
  assert.equal(trips,1);assert.ok(slow.tripped);
  const spike=createPerfMonitor(cfg);for(let i=0;i<120;i++)spike.sample(1/60);for(let i=0;i<5;i++)spike.sample(.2);for(let i=0;i<300;i++)spike.sample(1/60);assert.equal(spike.tripped,false);
});
