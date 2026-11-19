import layout from './data/map_layout.json';
import flow from './data/process_flow.json';
import {createWorld} from './world/world.js';
import {createUI} from './ui/panels.js';
import {equipmentPanel,runsheetPanel,crossSection} from './ui/processPanels.js';
import {applyAction,createLot,currentTask,latestRecord,nextEquipment} from './systems/runsheet.js';
import {createPersistence} from './systems/storage.js';
import {bindAlignment} from './ui/alignment.js';
import {bindDeposition} from './ui/fabricationPanels.js';
import {bindMetrology,bindToolActions} from './ui/metrologyPanel.js';
import {electricalPanel,exportToolbar,reportTable} from './ui/electricalPanel.js';
import {bindReportExport} from './ui/reportExport.js';
import {signedElectrical} from './systems/report.js';
import {equipmentStatuses} from './systems/equipmentStatus.js';
import './ui/styles.css';

const root=document.querySelector('#app');
const persistence=createPersistence(()=>window.localStorage,flow);
const loaded=persistence.load();let state=loaded.state,world,view=null;
const ui=createUI(root,layout,{
  onInteract:interact,onClose:()=>{view=null;world?.setPaused(false);},
  onReset:()=>{world?.reset();ui.message('방진복 착용실 입구로 이동했습니다.');},
  onRunsheet:()=>open('runsheet'),onSection:()=>open('section'),
  onGuide:()=>{const id=nextEquipment(state,flow);if(id)world?.walkTo(id);}
});
function refresh(){
  const task=currentTask(state,flow),r=latestRecord(state,flow),next=nextEquipment(state,flow);
  const name=layout.equipment.find(e=>e.id===next)?.name;
  const text=!task?`${state.electrical.grade} 등급 · Runsheet에서 전체 보고서를 저장할 수 있습니다.`:task.operation.modelId==='electrical'?(r?'전기적 결과를 확인하고 최종 서명하세요.':'전기적 테스트 장비에서 Vt와 Id–Vg를 측정하세요.'):r?(task.operation.measurementRequired?(r.measurement?(r.measurement.pass?'검사 합격 · 계측 장비에서 확인 서명하세요.':task.operation.acceptDefects?'결함 확인 · 인지 서명으로 계속하거나 재작업하세요.':'조건 이탈 · 재작업 또는 새 Lot이 필요합니다.'):`${name}에서 측정·검사하세요.`):'공정 완료 · 확인 서명하세요.'):`${name}에서 ${task.operation.modelId==='exposure'?'마스크 정렬과 노광':'현재 작업'}을 시작하세요.`;
  ui.mission(task?`${task.stage.number}. ${task.stage.title}`:'NMOS 제작 · 테스트 완료',text,next);
  ui.mini(crossSection(state,flow,true));world?.setGuidance(next);
  world?.setEquipmentStatus(equipmentStatuses(state,flow,layout.equipment.map(e=>e.id)));
}
function open(type,equipment=null){
  world?.setPaused(true);view={type,equipment};renderView();
}
function renderView(){
  if(!view)return;
  if(view.type==='equipment'){
    const isElectrical=view.equipment.id==='tester'&&(currentTask(state,flow)?.operation.modelId==='electrical'||!!state.electrical);
    ui.show(view.equipment.name,isElectrical?'ELECTRICAL TEST / NMOS-001':'EQUIPMENT INTERFACE',isElectrical);
    ui.content.innerHTML=isElectrical?electricalPanel(state,flow,layout):equipmentPanel(view.equipment,state,flow);
    const act=action=>perform({...action,equipmentId:view.equipment.id});
    ui.content.querySelector('#run-electrical')?.addEventListener('click',()=>act({type:'execute'}));
    ui.content.querySelector('#clean')?.addEventListener('click',()=>act({type:'execute'}));
    if(ui.content.querySelector('#measure-form'))bindMetrology(ui.content,act);
    else ui.content.querySelector('#measure')?.addEventListener('click',()=>act({type:'measure'}));
    bindToolActions(ui.content,act);
    bindAlignment(ui.content);
    const operation=currentTask(state,flow)?.operation;
    if(operation?.modelId==='deposit')bindDeposition(ui.content,state,operation);
    ui.content.querySelector('#process-form')?.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),op=currentTask(state,flow).operation;const input=Object.fromEntries(op.parameters.map(p=>[p.key,p.options?data.get(p.key):Number(data.get(p.key))]));act({type:'execute',input});});
    ui.content.querySelector('#restart-photo')?.addEventListener('click',()=>act({type:'restart-photo'}));
    ui.content.querySelector('#sign-form')?.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);act({type:'sign',name:data.get('signature'),acknowledgeDefects:data.get('acknowledge')==='on'});});
    bindReportExport(ui.content,state,flow,layout);
  }else if(view.type==='runsheet'){
    ui.show('Lot 공정 지시서','RUNSHEET / NMOS-001',true);
    ui.content.innerHTML=signedElectrical(state)?`${exportToolbar(state)}<p>최종 ${state.electrical.grade} 등급 / ${state.electrical.score}점 · 전체 ${state.records.length}개 기록</p>${reportTable(state,flow,layout)}<details><summary>새 Lot 시작</summary><p>현재 Lot을 초기화하고 세정부터 시작합니다.</p><button id="new-lot" class="secondary">새 Lot 시작</button></details>`:runsheetPanel(state,flow,layout);
    bindReportExport(ui.content,state,flow,layout);
    ui.content.querySelector('#new-lot')?.addEventListener('click',()=>{
      state=createLot();ui.saved(persistence.reset());world?.reset();refresh();renderView();ui.message('새 Lot을 시작합니다. 이전 Lot 기록을 초기화했습니다.');
    });
  }else{
    ui.show('현재 웨이퍼 단면','WAFER CROSS SECTION');ui.content.innerHTML=crossSection(state,flow);
  }
}
function perform(action){
  try{
    // UI cannot apply a process remotely, including after the current task changes.
    if(world?.getNearby()?.id!==action.equipmentId)throw new Error('해당 장비 근처에서만 실행할 수 있습니다.');
    const at=new Date().toISOString();state=applyAction(state,flow,action,at);
    ui.saved(persistence.record(action,at));if(action.type==='execute')world?.pulse(action.equipmentId);refresh();renderView();
  }catch(error){const el=ui.content.querySelector('#action-error');if(el)el.textContent=error.message;else ui.message(error.message);}
}
function interact(){if(ui.isOpen)return;const e=world?.getNearby();if(e)open('equipment',e);}
try{
  world=createWorld(ui.container,layout,{onNearby:e=>ui.nearby(e),onFrame:s=>ui.update(s),onMessage:t=>ui.message(t)});
  refresh();ui.saved(persistence.save());if(loaded.notice)ui.message(loaded.notice);
  window.addEventListener('keydown',e=>{
    if(e.repeat||e.target.matches('input,select,textarea')||ui.isOpen)return;
    if(e.code==='KeyE')interact();if(e.code==='KeyR')open('runsheet');if(e.code==='KeyC')open('section');
  });
}catch(error){console.error(error);const el=document.createElement('div');el.className='fatal';el.textContent='3D 화면을 시작하지 못했습니다. WebGL 2 지원과 브라우저 하드웨어 가속을 확인해 주세요.';root.append(el);}
