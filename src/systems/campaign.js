import DATA from '../data/campaign.json' with {type:'json'};
import {METROLOGY as M,INCIDENT2 as Q2,ADVISOR as A} from '../constants.js';
// 「첫 고객 주문」 운영 캠페인. 단일 Lot의 납기·비용 관리만 다룹니다.
// 원칙
//  - 시간·비용은 모두 state.records(이벤트 기록)에서 다시 계산합니다(원장). 실제 시각(executedAt)은 쓰지 않습니다.
//  - 기존 시간 기록(계측 엔진의 측정 시간, INCIDENT 001/002 검사 시간, AI 회의 시간)은 그 값을 그대로 쓰고,
//    퀘스트 누적값(incident.minutes, metrology.minutes)은 다시 더하지 않습니다(이중 계산 방지).
//  - 품질 상태는 플레이어가 측정·검사로 확인한 값만 씁니다. 숨은 원인·실제 두께는 쓰지 않습니다.
//  - 모든 시간·비용 가정은 src/data/campaign.json에 있고 검증 필요입니다.
export const CAMPAIGN=DATA;
export const ORDERS=DATA.orders;
export const CATEGORY_LABELS={process:'공정',metrology:'필수 계측·검사',inspection:'추가 검사',rework:'재작업',maintenance:'정비',meeting:'회의',action:'조치',closing:'출하·종료'};
export const DECISION_LABELS={ship:'출하',withhold:'출하 보류 (미납)',scrap:'Lot 폐기 (미납)'};
const THICKNESS=['deal-grove','gate-oxide','deposit'];
const ID001='INCIDENT-001',ID002='INCIDENT-002';
const r1=v=>Math.round(v*10)/10;
const ops=flow=>flow.stages.flatMap(stage=>stage.operations.map(operation=>({stage,operation})));
const opById=(flow,id)=>ops(flow).find(t=>t.operation.id===id)?.operation??null;
const currentOf=(state,flow)=>ops(flow)[state.cursor]??null;
const latestOf=(state,flow)=>{const t=currentOf(state,flow);return t?[...state.records].reverse().find(r=>r.operationId===t.operation.id&&!r.superseded)??null:null;};
export const orderOf=state=>ORDERS.find(o=>o.id===state.campaign?.orderId)??null;
export const isActive=state=>state.campaign?.phase==='active';

// ---- 시작 ----
export function startCampaign(state,action,now,startIncident){
  if(state.campaign)throw new Error('이 Lot은 이미 캠페인으로 진행 중이에요.');
  if(state.records.length)throw new Error('캠페인은 새 Lot의 첫 작업 전에만 시작할 수 있어요.');
  const o=ORDERS.find(x=>x.id===action.orderId);if(!o)throw new Error('주문을 선택하세요.');
  state.campaign={orderId:o.id,phase:'active',startedAt:now,closedAt:null,decision:null,acknowledgedNonconforming:false,maintenance:[],evaluation:null};
  // 주문에 걸린 돌발 상황은 기존 퀘스트 엔진으로 시작합니다(원인은 시드로 숨김).
  if(o.incident)startIncident(state,{quest:o.incident,mode:'ai',cause:action.cause},now);
  return {kind:'campaign-start',orderId:o.id,title:o.title,dueMinutes:o.dueMinutes,budget:o.budget};
}

// ---- 단가 ----
export function processCost(op,input={}){
  const p=DATA.process[op.modelId];if(!p)return {minutes:0,cost:0};
  const recipe=p.recipeMinutesKey?Number(input[p.recipeMinutesKey])||0:p.recipeSecondsKey?(Number(input[p.recipeSecondsKey])||0)/60:0;
  return {minutes:p.overheadMinutes+recipe,cost:p.cost};
}
// 필수 계측 계획(남은 공정 예측용). 두께 공정은 계측 엔진의 지점당 시간 × 계획 지점 수.
export function measurePlan(op){
  if(!op.measurementRequired)return {minutes:0,cost:0};
  if(THICKNESS.includes(op.modelId)){const n=DATA.metrologyPlan.requiredSites;return {minutes:n*M.minutesPerSite,cost:n*DATA.metrology.costPerSite};}
  const t=DATA.inspection[op.measurementType];return t?{minutes:t.minutes,cost:t.cost}:{minutes:0,cost:0};
}
const targetInput=op=>Object.fromEntries(op.parameters.map(p=>[p.key,p.target]));

// ---- 원장 ----
// 기록 하나 = 원장 항목 0개 이상. source는 시간 값을 어디서 가져왔는지 표시합니다.
export function buildLedger(state,flow){
  const entries=[],seen=new Set();
  const add=(r,category,label,minutes,cost,source,extra={})=>entries.push({recordId:r.id,category,label,equipmentId:r.equipmentId,minutes:Number(minutes)||0,cost:Number(cost)||0,source,...extra});
  for(const r of state.records){
    const op=opById(flow,r.operationId);
    if(op){
      const repeat=seen.has(op.id);seen.add(op.id);
      if(op.modelId==='electrical'&&repeat)add(r,'inspection','전기적 재측정 (조치 검증)',Q2.minutes.retest,DATA.incident002.retestCost,'INCIDENT 002 설정');
      else{const c=processCost(op,r.input);add(r,repeat?'rework':'process',`${repeat?'재작업 · ':''}${r.stageTitle} · ${op.id}`,c.minutes,c.cost,'campaign.json');}
      if(r.measurements?.length)r.measurements.forEach((m,i)=>add(r,i===0?'metrology':'inspection',`${i===0?'필수 계측':'추가 계측(재측정)'} · ${op.id} ${m.observed.length}점`,m.minutes,m.observed.length*DATA.metrology.costPerSite,'계측 엔진(metrology.js)',{sites:m.observed.length}));
      else if(r.measurement&&op.modelId!=='electrical'){const t=DATA.inspection[op.measurementType];if(t)add(r,'metrology',`필수 검사 · ${op.id}`,t.minutes,t.cost,'campaign.json');}
      continue;
    }
    const res=r.result??{};
    switch(r.operationId){
      case 'photo-rework':add(r,'rework','포토 재작업 (PR 제거)',DATA.rework.photoStrip.minutes,DATA.rework.photoStrip.cost,'campaign.json');break;
      case 'metrology-reference':add(r,'inspection','기준 시료 측정',res.minutes,DATA.metrology.referenceCost,'계측 엔진(metrology.js)');break;
      case 'metrology-calibration':add(r,'maintenance','두께 측정 장비 교정',res.minutes,DATA.maintenance['metrology-calibration'].cost,'계측 엔진(metrology.js)');break;
      case 'incident-log':add(r,'inspection','산화로 공정 로그 조회',res.minutes,DATA.incident001.logCost,'INCIDENT 001 설정');break;
      case 'incident-meeting':add(r,'meeting',`부서 회의 (${res.source==='ai'?'AI':'규칙 기반'})`,A.meetingMinutes,DATA.meeting.cost,'AI 회의 설정');break;
      case 'incident2-check':add(r,'inspection',res.label,res.minutes,DATA.incident002.checkCost[res.check],'INCIDENT 002 설정');break;
      case 'incident2-action':add(r,'action',`조치 · ${res.disposition}`,res.minutes,DATA.incident002.actionCost[res.disposition],'INCIDENT 002 설정');break;
      case 'incident2-verify':if(res.autoCheck)add(r,'inspection',`검증용 ${res.autoCheck.label}`,res.autoCheck.minutes,DATA.incident002.checkCost[res.autoCheck.kind],'INCIDENT 002 설정');break;
      case 'campaign-maintenance':add(r,'maintenance',res.label,res.minutes,res.cost,'campaign.json');break;
      case 'campaign-close':{const c=DATA.closing[res.decision];add(r,'closing',c.label,c.minutes,c.cost,'campaign.json');break;}
      default:break; // 시작·HOLD·판정·조치 변경은 시간·비용 없음
    }
  }
  const byCategory=Object.fromEntries(Object.keys(CATEGORY_LABELS).map(k=>[k,{minutes:0,cost:0,count:0}]));
  for(const e of entries){const c=byCategory[e.category];c.minutes+=e.minutes;c.cost+=e.cost;c.count++;}
  const minutes=entries.reduce((a,e)=>a+e.minutes,0),cost=entries.reduce((a,e)=>a+e.cost,0);
  return {entries,totals:{minutes,cost,byCategory}};
}
// 대사(reconciliation): 원장에 넣은 계측 엔진 시간 합 = 계측 엔진의 누적 시간이어야 함(중복·누락 없음).
export function reconcile(state,ledger){
  const metrology=ledger.entries.filter(e=>e.source==='계측 엔진(metrology.js)').reduce((a,e)=>a+e.minutes,0);
  return {metrologyLedgerMinutes:metrology,metrologyEngineMinutes:state.metrology.minutes,metrologyMatch:Math.abs(metrology-state.metrology.minutes)<1e-6};
}

// ---- 상태 ----
export function holdStatus(state){
  const inc=state.incident,p=inc?.phase;
  if(!inc||['armed','missed','prevented'].includes(p))return {hold:false,label:'HOLD 없음'};
  if(p==='alarm')return {hold:true,label:inc.id===ID002?'OPEN 경고 · HOLD 필요':'OOS 경고 · HOLD 필요'};
  if(p==='hold')return {hold:true,label:'HOLD 중 · 원인 미확정'};
  if(p==='action')return {hold:true,label:'HOLD 유지 · 원인 판정 완료, 조치·검증 대기'};
  if(p==='resolved')return {hold:false,label:`HOLD 해제 · 판정 완료 (${inc.disposition})`};
  return {hold:false,label:'HOLD 해제 · 조치 검증 완료'};
}
// 최종 전기 규격 판정(주문 규격 기준). 전기적 테스트 측정값(교육용 모델 계산)을 씁니다.
export function specCheck(state,o=orderOf(state)){
  const rec=[...state.records].reverse().find(r=>r.result?.kind==='electrical'&&!r.superseded);
  if(!o)return {status:'no-order',items:[]};
  if(!rec)return {status:'not-tested',label:'전기적 테스트 전',items:[]};
  const e=rec.result;
  if(e.measurementStatus==='open'||e.ionA===null||!e.valid)return {status:'not-measured',label:'측정 불가 (OPEN·연결 불량) · 적합 확인 불가',items:[]};
  const s=o.spec,ion=e.ionA*1000;
  const items=[{label:'Vt',value:e.vtV,unit:'V',min:s.vtMinV,max:s.vtMaxV},{label:'Ion @Vg=3.3 V',value:ion,unit:'mA',min:s.ionMinMilliA,max:s.ionMaxMilliA}].map(i=>({...i,ok:i.value>=i.min&&i.value<=i.max}));
  const ok=items.every(i=>i.ok);
  return {status:ok?'conforming':'nonconforming',label:ok?'주문 규격 적합':'주문 규격 미달',items,signed:!!rec.signature};
}
// 확인된 품질 상태: 서명된 공정의 검사 결과와 현재 미결 사항(관측값만)
export function qualityStatus(state,flow){
  const signed=state.records.filter(r=>r.signature&&!r.superseded&&r.measurement&&r.result?.kind!=='electrical');
  const passed=signed.filter(r=>r.measurement.pass).length,accepted=signed.filter(r=>!r.measurement.pass).map(r=>r.stageTitle+' · '+r.operationId);
  const t=currentOf(state,flow),r=latestOf(state,flow);let current=null;
  if(t&&r&&t.operation.measurementRequired){
    if(!r.measurement)current='현재 공정 측정 대기 · 품질 미확인';
    else if(!r.measurement.pass)current=t.operation.acceptDefects?'현재 공정 검사에서 결함 확인 · 인지 서명 또는 재작업 판단 필요':'현재 공정 검사 불합격 · 재작업·폐기 판단 필요';
    else if(THICKNESS.includes(t.operation.modelId)&&r.measurement.observed.length<DATA.metrologyPlan.requiredSites)current=`측정 계획 미달 (${r.measurement.observed.length}/${DATA.metrologyPlan.requiredSites}지점)`;
  }
  return {inspectionsPassed:passed,defectsAccepted:accepted,current,electrical:specCheck(state)};
}

// ---- 예상 완료 ----
// 남은 공정(표준 레시피) + 이미 정해진 조치만 더합니다. 원인을 모르는 HOLD, 불합격 후 재작업 횟수는 '미확정'으로 표시.
export function estimate(state,flow){
  const L=buildLedger(state,flow),known=[],uncertain=[];let minutes=0,cost=0;
  const base={elapsedMinutes:L.totals.minutes,spent:L.totals.cost};
  if(state.campaign?.phase==='closed')return {...base,remainingMinutes:0,remainingCost:0,etaMinutes:L.totals.minutes,projectedCost:L.totals.cost,known,uncertain,closed:true};
  const add=(label,m,c)=>{known.push({label,minutes:m,cost:c});minutes+=m;cost+=c;};
  const list=ops(flow),inc=state.incident,cur=list[state.cursor],r=latestOf(state,flow);
  let scrapPlanned=(inc?.id===ID001&&inc.phase==='resolved'&&inc.disposition==='scrap')||(inc?.id===ID002&&String(inc.disposition??'').startsWith('scrap')&&['action','closed'].includes(inc.phase));
  if(cur&&!scrapPlanned){
    const op=cur.operation;
    if(!r){const p=processCost(op,targetInput(op)),m=measurePlan(op);add(`현재 공정 ${op.id} (표준 레시피)`,p.minutes+m.minutes,p.cost+m.cost);}
    else if(op.measurementRequired&&!r.measurement){const m=measurePlan(op);add(`현재 공정 필수 계측 ${op.id}`,m.minutes,m.cost);}
    else if(op.measurementRequired&&r.measurement){
      const sites=r.measurement.observed?.length,need=DATA.metrologyPlan.requiredSites;
      const override=inc?.id===ID001&&op.id==='field-oxidation'&&inc.phase==='resolved'&&inc.disposition==='use-as-is';
      if(!r.measurement.pass&&!op.acceptDefects&&!override){
        if(inc?.id===ID001&&op.id==='field-oxidation'&&inc.phase==='resolved'&&inc.disposition==='remeasure'){const n=need;add('교정 + 5지점 재측정 (판정한 조치)',M.calibrationMinutes+n*M.minutesPerSite,DATA.maintenance['metrology-calibration'].cost+n*DATA.metrology.costPerSite);uncertain.push('재측정 결과가 합격할지는 측정 전까지 모름');}
        else if(!['alarm','hold'].includes(inc?.phase))uncertain.push('현재 공정 검사 불합격 · 재작업 여부와 횟수가 정해지지 않음');
      }else if(THICKNESS.includes(op.modelId)&&sites<need){const n=need;add(`측정 계획(${need}지점) 재측정`,n*M.minutesPerSite,n*DATA.metrology.costPerSite);}
    }
    const rest=list.slice(state.cursor+1);let rm=0,rc=0;
    for(const {operation} of rest){const p=processCost(operation,targetInput(operation)),m=measurePlan(operation);rm+=p.minutes+m.minutes;rc+=p.cost+m.cost;}
    if(rest.length)add(`남은 공정 ${rest.length}개 · 표준 레시피 + 필수 계측`,rm,rc);
  }
  if(inc&&['alarm','hold'].includes(inc.phase))uncertain.push(inc.phase==='alarm'?'경고 발생 · HOLD 후 조사·조치 시간과 비용을 아직 모름':'HOLD 중 원인 미확정 · 추가 검사·조치 시간과 비용은 포함 안 함');
  if(inc?.id===ID002&&inc.phase==='action'){
    if(!inc.action)add(`판정한 조치 실행 (${inc.disposition})`,Q2.minutes.action[inc.disposition],DATA.incident002.actionCost[inc.disposition]);
    if(inc.disposition==='reseat-retest')add('재측정으로 조치 검증',Q2.minutes.retest,DATA.incident002.retestCost);
    else if(inc.disposition==='ship-as-is')uncertain.push('결과대로 서명하는 조치는 OPEN을 해결하지 못해 검증이 통과하지 않음');
    uncertain.push('조치 검증이 실패하면 조치를 다시 정해야 함');
  }
  if(scrapPlanned){add('Lot 폐기 처리 (판정한 조치)',DATA.closing.scrap.minutes,DATA.closing.scrap.cost);uncertain.push('폐기로 판정해 이 주문은 납품할 제품이 없음');}
  else add('출하 처리',DATA.closing.ship.minutes,DATA.closing.ship.cost);
  return {...base,remainingMinutes:minutes,remainingCost:cost,etaMinutes:L.totals.minutes+minutes,projectedCost:L.totals.cost+cost,known,uncertain,
    note:'아직 드러나지 않은 이상은 예측에 넣지 않아요.'};
}
export function snapshot(state,flow){
  const o=orderOf(state);if(!o)return null;
  const L=buildLedger(state,flow);
  return {order:o,ledger:L,estimate:estimate(state,flow),hold:holdStatus(state),quality:qualityStatus(state,flow),reconcile:reconcile(state,L),
    remainingBudget:o.budget-L.totals.cost,minutesToDue:o.dueMinutes-L.totals.minutes};
}

// ---- 정비 ----
// 적용 대상: 정비한 장비의 "다음 가동"부터. 이미 가공된 웨이퍼는 바꾸지 않습니다.
export function performMaintenance(state,action){
  if(!isActive(state))throw new Error('정비는 캠페인 진행 중에만 기록해요.');
  const key=action.item,item=DATA.maintenance[key];
  if(!item||key==='metrology-calibration')throw new Error(key==='metrology-calibration'?'계측 장비 교정은 계측 장비 화면에서 실행하세요.':'알 수 없는 정비 항목이에요.');
  if(action.equipmentId!==item.equipmentId)throw new Error(`${item.label}은(는) 해당 장비에서 실행하세요.`);
  if(state.campaign.maintenance.some(m=>m.item===key))throw new Error('이번 Lot에서 이미 이 정비를 했어요.');
  const inc=state.incident;let finding,found=false;
  if(key==='furnace-pm'){
    if(inc?.id===ID001&&inc.cause==='overrun'){
      found=true;
      if(inc.faultApplied)finding='단계 타이머 지연 발견·교체. 이미 산화된 Field 산화막 두께는 그대로예요.';
      else{inc.preventedBy='furnace-pm';finding='단계 타이머 지연 발견·교체. 다음 산화로 가동부터 레시피 시간대로 돌아요.';}
    }else finding='단계 타이머·열전대 이상 없음.';
  }else{
    if(inc?.id===ID002&&['alarm','hold','action'].includes(inc.phase))throw new Error('OPEN 조사 중에는 INCIDENT 002 절차(프로브 재접촉 검사·조치)로 처리하세요.');
    if(inc?.id===ID002&&inc.cause==='probe-contact'&&!inc.probeSeated){found=true;inc.probeSeated=true;if(inc.phase==='armed')inc.preventedBy='tester-pm';finding='탐침 팁 오염 발견·교체. 다음 전기적 테스트부터 적용돼요.';}
    else finding='탐침 상태 이상 없음 · 예방 교체만 함.';
  }
  state.campaign.maintenance.push({item:key,found,finding});
  return {kind:'campaign-maintenance',item:key,label:item.label,minutes:item.minutes,cost:item.cost,target:item.target,effect:item.effect,finding,found};
}
// 캠페인 서명 규칙: 두께 공정 필수 계측은 측정 계획(5지점) 이상이어야 함.
export function campaignSignGate(state,op,record){
  if(!state.campaign||!THICKNESS.includes(op.modelId))return;
  const n=record.measurement?.observed?.length??0,need=DATA.metrologyPlan.requiredSites;
  if(n<need)throw new Error(`측정 계획: 캠페인에서는 필수 계측을 ${need}지점 모두 측정해야 서명할 수 있어요 (현재 ${n}지점).`);
}

// ---- 종료·평가 ----
export function closeCampaign(state,flow,action){
  const c=state.campaign;if(!c)throw new Error('캠페인 Lot이 아니에요.');if(c.phase!=='active')throw new Error('이미 끝난 캠페인이에요.');
  const d=action.decision;if(!DATA.closing[d])throw new Error('출하·보류·폐기 중 하나를 고르세요.');
  const hold=holdStatus(state).hold;
  if(d!=='scrap'){
    if(currentOf(state,flow))throw new Error('출하·보류 판단은 전기적 테스트 최종 서명까지 끝난 뒤에 할 수 있어요.');
    if(hold)throw new Error('HOLD 중에는 출하·보류를 결정할 수 없어요. 원인 조사·조치를 먼저 마치세요.');
  }
  if(d==='ship'&&specCheck(state).status!=='conforming'){
    if(action.acknowledgeNonconforming!==true)throw new Error('주문 규격 적합이 확인되지 않은 제품이에요. 그래도 출하하려면 규격 미달·미확인을 인지했다는 체크가 필요해요.');
    c.acknowledgedNonconforming=true;
  }
  c.decision=d;
  return {kind:'campaign-close',decision:d};
}
const incidentJudgment=inc=>{
  if(!inc)return [];
  if(inc.preventedBy)return [{level:'info',text:`예방 정비(${inc.preventedBy})로 장비 이상이 웨이퍼에 닿기 전에 제거됨`}];
  if(inc.phase==='armed')return [{level:'info',text:'이번 Lot에서는 이상 증상이 나타나지 않음'}];
  if(inc.phase==='missed')return [{level:'bad',text:'장비 이상이 있었지만 경고 없이 지나감'}];
  const e=inc.evaluation;if(!e)return [{level:'bad',text:'돌발 상황 조사를 끝내지 않음'}];
  const out=[{level:e.causeOk?'ok':'bad',text:`원인 판정 ${e.causeOk?'정확':'오판'}`},{level:e.bestDisposition?'ok':e.dispositionOk?'warn':'bad',text:`조치 ${e.bestDisposition?'최선':e.dispositionOk?'가능하지만 비용이 큼':'부적절'}`},{level:e.keyEvidenceFound?'ok':'warn',text:`핵심 증거 ${e.keyEvidenceFound?'확인 후 판정':'확인 없이 판정'}`}];
  if(e.unnecessaryChecks)out.push({level:'warn',text:`불필요한 검사 ${e.unnecessaryChecks}건`});
  return out;
};
export function evaluateCampaign(state,flow){
  const o=orderOf(state),c=state.campaign,L=buildLedger(state,flow),spec=specCheck(state,o),q=qualityStatus(state,flow),inc=state.incident,d=c.decision;
  const quality=d==='scrap'?{status:'scrapped',label:'제품 없음 (Lot 폐기)'}:{status:spec.status,label:spec.label,items:spec.items,defectsAccepted:q.defectsAccepted};
  const delivered=d==='ship',minutes=L.totals.minutes;
  const delivery=delivered?{status:minutes<=o.dueMinutes?'on-time':'late',minutes,dueMinutes:o.dueMinutes,lateBy:Math.max(0,minutes-o.dueMinutes)}:{status:'not-delivered',minutes,dueMinutes:o.dueMinutes};
  const cost={spent:L.totals.cost,budget:o.budget,overBy:Math.max(0,L.totals.cost-o.budget),status:L.totals.cost<=o.budget?'within':'over'};
  const items=[];
  if(d==='ship')items.push(spec.status==='conforming'?{level:'ok',text:'주문 규격 적합을 확인하고 출하'}:{level:'bad',text:'주문 규격 적합이 확인되지 않은 제품을 출하'});
  else if(d==='withhold')items.push(spec.status==='conforming'?{level:'bad',text:'규격에 맞는 제품을 출하하지 않음'}:{level:'ok',text:'규격 미달·미확인 제품의 출하를 보류'});
  else{
    const incScrap=(inc?.id===ID001&&inc.disposition==='scrap')||(inc?.id===ID002&&String(inc.disposition??'').startsWith('scrap'));
    const failed=!!q.current&&/불합격/.test(q.current);
    items.push(incScrap?{level:inc.evaluation?.dispositionOk?'ok':'bad',text:`돌발 상황 판정에 따라 Lot 폐기 (${inc.evaluation?.dispositionOk?'조치 적절':'조치 부적절'})`}:failed?{level:'ok',text:'검사 불합격을 근거로 Lot 폐기'}:{level:'warn',text:'검사 불합격 기록 없이 Lot 폐기'});
  }
  items.push(...incidentJudgment(inc));
  const maint=c.maintenance;if(maint.length)items.push({level:'info',text:`정비 ${maint.length}회 · 이상 발견 ${maint.filter(m=>m.found).length}회 / 이상 없음 ${maint.filter(m=>!m.found).length}회`});
  if(state.reworkCount)items.push({level:'info',text:`재작업 ${state.reworkCount}회`});
  const meetings=inc?.meetings??[];if(meetings.length)items.push({level:'info',text:`부서 회의 ${meetings.length}회 (AI ${meetings.filter(m=>m.source==='ai').length}회) · 결과 수치는 게임 원장이 계산`});
  const bad=items.filter(i=>i.level==='bad').length,warn=items.filter(i=>i.level==='warn').length;
  const judgment={rating:bad?'부적절':warn>=2?'보통':'적절',items};
  let grade,reason;
  if(d==='ship'&&spec.status!=='conforming'){grade='F';reason='규격 적합이 확인되지 않은 제품 출하 · 납기·비용과 관계없이 F';}
  else if(d!=='ship'){grade=judgment.rating==='부적절'?'F':'D';reason=judgment.rating==='부적절'?'납품하지 못했고 판단도 부적절':'납품은 못 했지만 판단은 근거가 있음 · 미납이라 D 이상 불가';}
  else{const n=[delivery.status==='on-time',cost.status==='within',judgment.rating==='적절'].filter(Boolean).length;grade=['C','B','A','S'][n];reason=`규격 적합 출하 · 납기 ${delivery.status==='on-time'?'준수':'지연'} · 예산 ${cost.status==='within'?'이내':'초과'} · 판단 ${judgment.rating}`;}
  return {orderId:o.id,decision:d,quality,delivery,cost,judgment,overall:{grade,reason},
    disclaimer:'Lot 1개의 결과예요. 양산 수율이나 공장 가동률을 뜻하지 않아요. 시간·비용 단가는 교육용 가정(검증 필요)이에요.'};
}

// ---- AI 회의용 운영 정보(관측·원장 값만) ----
export function operationsEvidence(state,flow){
  const s=snapshot(state,flow);if(!s)return null;const e=s.estimate,inc=state.incident;
  const options=[];
  if(inc?.id===ID001&&inc.phase==='hold')options.push({option:'기준 시료 측정',minutes:M.referenceMinutes,cost:DATA.metrology.referenceCost},{option:'산화로 공정 로그 조회',minutes:5,cost:DATA.incident001.logCost},{option:'5지점 재측정',minutes:DATA.metrologyPlan.requiredSites*M.minutesPerSite,cost:DATA.metrologyPlan.requiredSites*DATA.metrology.costPerSite},{option:'두께 측정 장비 교정',minutes:M.calibrationMinutes,cost:DATA.maintenance['metrology-calibration'].cost});
  if(inc?.id===ID002&&['hold','action'].includes(inc.phase))for(const k of Object.keys(DATA.incident002.checkCost))options.push({option:`검사 ${k}`,minutes:Q2.minutes[k],cost:DATA.incident002.checkCost[k]});
  for(const [k,m] of Object.entries(DATA.maintenance))if(k!=='metrology-calibration'&&!state.campaign.maintenance.some(x=>x.item===k))options.push({option:m.label,minutes:m.minutes,cost:m.cost,target:m.target});
  return {id:'OPS',type:'operations-status',orderId:s.order.id,unitTime:'가상 분',unitCost:DATA.units.cost,
    dueMinutes:s.order.dueMinutes,elapsedMinutes:r1(e.elapsedMinutes),minutesToDue:r1(s.minutesToDue),budget:s.order.budget,spent:r1(e.spent),remainingBudget:r1(s.remainingBudget),
    estimate:{etaMinutes:r1(e.etaMinutes),projectedCost:r1(e.projectedCost),uncertain:e.uncertain},hold:s.hold.label,
    confirmedQuality:{inspectionsPassed:s.quality.inspectionsPassed,defectsAccepted:s.quality.defectsAccepted,current:s.quality.current,finalElectrical:s.quality.electrical.label??s.quality.electrical.status},
    orderSpec:s.order.spec,optionPrices:options,
    maintenanceDone:state.campaign.maintenance.map(m=>({item:m.item,finding:m.finding})),
    note:'모든 숫자는 게임 원장이 계산한 값. 예상 완료는 남은 공정 표준 레시피와 알려진 조치만 포함.'};
}
