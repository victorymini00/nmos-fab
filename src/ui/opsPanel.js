import {CAMPAIGN,ORDERS,CATEGORY_LABELS,DECISION_LABELS,snapshot,isActive} from '../systems/campaign.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COST=CAMPAIGN.units.cost;
export const fmtMin=m=>{const t=Math.round(m),h=Math.floor(Math.abs(t)/60),mm=Math.abs(t)%60;return `${t<0?'−':''}${h}시간 ${String(mm).padStart(2,'0')}분`;};
const num=v=>Math.round(v).toLocaleString('ko-KR');
const specText=s=>`Vt ${s.vtMinV}~${s.vtMaxV} V · Ion ${s.ionMinMilliA}~${s.ionMaxMilliA} mA (Vg 3.3 V, Vds 1 V) · 측정 가능(OPEN 아님)`;

// Runsheet에 붙는 캠페인 시작 폼. 고르지 않으면 기존 자유 실습 그대로.
export function campaignStartSection(state){
  const active=state.campaign?ORDERS.find(o=>o.id===state.campaign.orderId):null;
  return `<section class="ops-start"><div class="incident-head"><span>OPERATIONS CAMPAIGN</span><strong>첫 고객 주문</strong></div>
  <p>새 Lot으로 시작해요. 주문을 고르면 완료 기한·예산·최종 전기 규격이 걸리고, 공정·계측·검사·재작업·정비·회의마다 <strong>가상 시간과 비용</strong>이 원장에 쌓여요. 이 폼을 쓰지 않으면 지금처럼 자유 실습이에요.</p>
  ${active?`<p class="ops-note">지금 Lot은 캠페인 ${esc(active.id)} 진행 중이에요. 새 주문을 시작하면 현재 Lot 기록은 초기화돼요.</p>`:''}
  <form id="campaign-start" class="order-list">${ORDERS.map((o,i)=>`<label class="order-card"><input type="radio" name="order" value="${esc(o.id)}" ${i===0?'checked':''}><span><strong>${esc(o.id)} · ${esc(o.title)}</strong><br>${esc(o.customer)}<br>기한 ${fmtMin(o.dueMinutes)} (가상) · 예산 ${num(o.budget)} ${esc(COST)}<br><span class="muted">${esc(specText(o.spec))}</span><br><span class="muted">${esc(o.brief)}</span></span></label>`).join('')}
  <button class="primary">새 Lot으로 주문 시작</button></form>
  <p class="muted">단가·기한·예산은 교육용 가정이며 ${esc(CAMPAIGN.verification)} (src/data/campaign.json).</p></section>`;
}
// 화면 왼쪽 위 미션 카드 아래 요약
export function opsHud(state,flow){
  const s=snapshot(state,flow);if(!s)return null;
  if(state.campaign.phase==='closed')return `${s.order.id} 종료 · ${DECISION_LABELS[state.campaign.decision]} · 종합 ${state.campaign.evaluation.overall.grade} · 운영 패널 [O]`;
  const e=s.estimate;
  return `${s.order.id} · 가상 ${fmtMin(e.elapsedMinutes)} / 기한 ${fmtMin(s.order.dueMinutes)} · 잔여 예산 ${num(s.remainingBudget)} · ${s.hold.label}${e.uncertain.length?' · 예상 미확정':''} · 운영 패널 [O]`;
}
function tile(title,main,sub,cls=''){return `<div class="ops-tile ${cls}"><span>${title}</span><strong>${main}</strong><p>${sub}</p></div>`;}
function ledgerTable(L){
  const rows=Object.entries(L.totals.byCategory).filter(([,v])=>v.count);
  return `<table class="ops-table"><thead><tr><th>분류</th><th>건수</th><th>가상 시간</th><th>비용</th></tr></thead><tbody>${rows.map(([k,v])=>`<tr><td>${CATEGORY_LABELS[k]}</td><td>${v.count}</td><td>${fmtMin(v.minutes)}</td><td>${num(v.cost)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">아직 기록 없음</td></tr>'}<tr class="total"><td>합계</td><td>${L.entries.length}</td><td>${fmtMin(L.totals.minutes)}</td><td>${num(L.totals.cost)}</td></tr></tbody></table>
  <details><summary>원장 전체 (${L.entries.length}건)</summary><div class="table-scroll"><table class="ops-table"><thead><tr><th>기록</th><th>분류</th><th>내용</th><th>시간(분)</th><th>비용</th><th>시간 출처</th></tr></thead><tbody>${L.entries.map(e=>`<tr><td>#${e.recordId}</td><td>${CATEGORY_LABELS[e.category]}</td><td>${esc(e.label)}</td><td>${e.minutes.toFixed(1)}</td><td>${num(e.cost)}</td><td class="muted">${esc(e.source)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function estimateBox(s){
  const e=s.estimate,o=s.order,late=e.etaMinutes>o.dueMinutes,over=e.projectedCost>o.budget;
  return `<section class="ops-box"><h4>예상 완료 <span class="ops-badge ${e.uncertain.length?'st-hold':'st-ok'}">${e.uncertain.length?'미확정 요인 있음':'계획 기준 예측'}</span></h4>
  <p>예상 완료 <strong>${fmtMin(e.etaMinutes)}</strong> (기한 ${fmtMin(o.dueMinutes)} · <span class="${late?'st-bad':'st-ok'}">${late?`${fmtMin(e.etaMinutes-o.dueMinutes)} 초과 예상`:`${fmtMin(o.dueMinutes-e.etaMinutes)} 여유`}</span>)<br>
  예상 총비용 <strong>${num(e.projectedCost)}</strong> (예산 ${num(o.budget)} · <span class="${over?'st-bad':'st-ok'}">${over?`${num(e.projectedCost-o.budget)} 초과 예상`:`${num(o.budget-e.projectedCost)} 남음`}</span>)</p>
  <p class="muted">근거: 이미 쓴 시간·비용(원장) + 아래 항목</p><ul class="mini-list">${e.known.map(k=>`<li>${esc(k.label)} · ${fmtMin(k.minutes)} · ${num(k.cost)}</li>`).join('')||'<li>남은 항목 없음</li>'}</ul>
  ${e.uncertain.length?`<ul class="ops-uncertain">${e.uncertain.map(u=>`<li>⚠ ${esc(u)}</li>`).join('')}</ul>`:''}<p class="muted">${esc(e.note??'')}</p></section>`;
}
function qualityText(q){
  const el=q.electrical;
  return `검사 합격 ${q.inspectionsPassed}건 · 결함 인지 서명 ${q.defectsAccepted.length}건${q.current?`<br><span class="st-hold">${esc(q.current)}</span>`:''}<br>최종 전기: ${esc(el.label??'전기적 테스트 전')}`;
}
const LEVEL={ok:'✓',warn:'△',bad:'✗',info:'·'};
function evaluationView(ev){
  const q=ev.quality,d=ev.delivery,c=ev.cost,j=ev.judgment;
  const card=(title,status,cls,body)=>`<div class="ops-eval ${cls}"><span>${title}</span><strong>${status}</strong>${body}</div>`;
  return `<section class="ops-result"><div class="ops-grade"><strong>${ev.overall.grade}</strong><span>종합</span><p>${esc(ev.overall.reason)}</p></div>
  <div class="ops-evals">
  ${card('품질 적합성',esc(q.label),q.status==='conforming'?'good':'bad',`${(q.items??[]).map(i=>`<p>${esc(i.label)} ${i.value.toFixed(i.unit==='V'?3:3)} ${i.unit} (규격 ${i.min}~${i.max}) ${i.ok?'✓':'✗'}</p>`).join('')}${q.defectsAccepted?.length?`<p class="muted">결함 인지 서명: ${q.defectsAccepted.map(esc).join(', ')}</p>`:''}`)}
  ${card('납기',d.status==='on-time'?'기한 준수':d.status==='late'?'지연':'미납',d.status==='on-time'?'good':'bad',`<p>가상 ${fmtMin(d.minutes)} / 기한 ${fmtMin(d.dueMinutes)}${d.lateBy?` · ${fmtMin(d.lateBy)} 지연`:''}</p>`)}
  ${card('비용',c.status==='within'?'예산 이내':'예산 초과',c.status==='within'?'good':'bad',`<p>${num(c.spent)} / 예산 ${num(c.budget)}${c.overBy?` · ${num(c.overBy)} 초과`:''}</p>`)}
  ${card('판단 과정',j.rating,j.rating==='적절'?'good':j.rating==='보통'?'mid':'bad',`<ul class="mini-list">${j.items.map(i=>`<li class="lv-${i.level}">${LEVEL[i.level]} ${esc(i.text)}</li>`).join('')}</ul>`)}
  </div><p class="muted">${esc(ev.disclaimer)}</p><p class="muted">새 주문은 Runsheet(R)의 「첫 고객 주문」에서 시작해요.</p></section>`;
}
function closeForm(state,s,done){
  const spec=s.quality.electrical,hold=s.hold.hold,canDecide=done&&!hold;
  return `<section class="ops-box"><h4>주문 종료 판단</h4>
  <p>${done?hold?'HOLD 중이라 출하·보류를 정할 수 없어요.':`최종 전기: <strong>${esc(spec.label)}</strong>${spec.items?.length?' · '+spec.items.map(i=>`${esc(i.label)} ${i.value.toFixed(3)} ${i.unit} ${i.ok?'✓':'✗'}`).join(' · '):''}`:'출하·보류는 전기적 테스트 최종 서명까지 끝난 뒤 정해요. 필수 계측·서명은 건너뛸 수 없어요.'}</p>
  <form id="campaign-close" class="ops-close">
  ${canDecide&&spec.status!=='conforming'?'<label class="check"><input type="checkbox" name="ack">주문 규격 적합이 확인되지 않았다는 것을 알고도 출하합니다</label>':''}
  <div class="tool-actions"><button class="primary" name="decision" value="ship" ${canDecide?'':'disabled'}>출하 · ${CAMPAIGN.closing.ship.minutes}분</button><button class="secondary" name="decision" value="withhold" ${canDecide?'':'disabled'}>출하 보류 (미납)</button></div>
  <details><summary>Lot 폐기 (언제든 가능 · 되돌릴 수 없음)</summary><label class="check"><input type="checkbox" name="scrapOk">폐기하면 이 주문은 납품할 제품이 없어요</label><button class="secondary" name="decision" value="scrap">Lot 폐기 · ${CAMPAIGN.closing.scrap.minutes}분</button></details>
  </form></section>`;
}
export function opsView(state,flow,nowMs=Date.now()){
  const s=snapshot(state,flow);
  if(!s)return `<p>지금 Lot은 자유 실습 모드예요. 운영 제약(기한·예산·원장)은 캠페인을 시작했을 때만 적용돼요.</p>${campaignStartSection(state)}`;
  const o=s.order,L=s.ledger,c=state.campaign,done=!flow.stages.flatMap(st=>st.operations)[state.cursor];
  const realMin=Math.max(0,(nowMs-Date.parse(c.startedAt))/60000);
  const closed=c.phase==='closed';
  return `<section class="ops-order"><div><span class="eyebrow">CUSTOMER ORDER</span><strong>${esc(o.id)} · ${esc(o.title)}</strong><p>${esc(o.customer)}</p></div><p>기한 <strong>${fmtMin(o.dueMinutes)}</strong> (가상) · 예산 <strong>${num(o.budget)}</strong> ${esc(COST)}<br>최종 전기 규격: ${esc(specText(o.spec))}<br>측정 계획: 두께 공정 필수 계측 ${CAMPAIGN.metrologyPlan.requiredSites}지점</p></section>
  ${closed?evaluationView(c.evaluation):''}
  <div class="ops-tiles">
  ${tile('가상 누적 시간',fmtMin(L.totals.minutes),closed?'종료 시점':`기한까지 ${s.minutesToDue>=0?fmtMin(s.minutesToDue):`${fmtMin(-s.minutesToDue)} 초과`}`,s.minutesToDue<0?'bad':'')}
  ${tile('누적 비용',num(L.totals.cost),`잔여 예산 ${num(s.remainingBudget)}`,s.remainingBudget<0?'bad':'')}
  ${tile('HOLD 상태',esc(s.hold.label),s.hold.hold?'원인 조사·조치가 끝나야 진행·출하 가능':'진행 가능',s.hold.hold?'hold':'')}
  ${tile('확인된 품질 상태',esc(s.quality.electrical.status==='conforming'?'규격 적합 확인':s.quality.electrical.status==='nonconforming'?'규격 미달':s.quality.electrical.status==='not-measured'?'측정 불가':'최종 미확인'),qualityText(s.quality),s.quality.electrical.status==='conforming'?'good':['nonconforming','not-measured'].includes(s.quality.electrical.status)?'bad':'')}
  </div>
  <p class="ops-note">시간 구분: 위 시간은 <strong>공장 가상 시간</strong>(원장 합계)이에요. 실제 플레이 시간은 ${fmtMin(realMin)}(참고용)이고 납기·평가에 쓰지 않아요. AI 회의 응답을 기다린 실제 시간도 생산 지연에 넣지 않고, 회의 1회는 가상 5분으로 고정이에요.</p>
  ${closed?'':estimateBox(s)}
  <section class="ops-box"><h4>운영 원장</h4><p class="muted">공정·계측·추가 검사·재작업·정비·회의·조치를 기록 단위로 한 번씩만 계산해요. 계측·퀘스트 시간은 기존 설정값을 그대로 쓰고, 퀘스트의 누적 조사 시간은 다시 더하지 않아요.</p>${ledgerTable(L)}
  <p class="muted">대사: 원장의 계측 엔진 시간 ${s.reconcile.metrologyLedgerMinutes}분 = 계측 엔진 누적 ${s.reconcile.metrologyEngineMinutes}분 ${s.reconcile.metrologyMatch?'✓':'✗ 불일치'}</p></section>
  <section class="ops-box"><h4>정비 항목</h4><p class="muted">해당 장비 화면에서 실행해요. 정비는 그 장비의 다음 가동부터 적용되고, 이미 가공된 웨이퍼는 바꾸지 않아요.</p><ul class="mini-list">${Object.entries(CAMPAIGN.maintenance).map(([k,m])=>{const d=c.maintenance.find(x=>x.item===k);return `<li><strong>${esc(m.label)}</strong> · ${m.minutes?`${m.minutes}분 · `:''}${m.cost} · 적용: ${esc(m.target)}<br><span class="muted">${esc(m.effect)}</span>${d?`<br>실행함: ${esc(d.finding)}`:''}</li>`;}).join('')}</ul></section>
  ${closed?'':closeForm(state,s,done)}
  <p class="muted">모든 단가·기한·예산은 교육용 가정(${esc(CAMPAIGN.verification)}). Lot 1개 결과이며 수율·가동률이 아니에요.</p>
  <p id="action-error" class="error" role="alert"></p>`;
}
// 산화로·테스터 화면에 붙는 정비 영역
export function maintenanceSection(state,equipmentId){
  if(!isActive(state))return '';
  const items=Object.entries(CAMPAIGN.maintenance).filter(([k,m])=>m.equipmentId===equipmentId&&k!=='metrology-calibration');if(!items.length)return '';
  return `<section class="ops-maint"><h4>설비 정비 · 캠페인 ${esc(state.campaign.orderId)}</h4>${items.map(([k,m])=>{const d=state.campaign.maintenance.find(x=>x.item===k);
    return `<div class="maint-item"><p><strong>${esc(m.label)}</strong> · ${m.minutes}분 · 비용 ${m.cost}</p><p>적용 대상: ${esc(m.target)}</p><p class="muted">효과: ${esc(m.effect)}</p>${d?`<p class="result">실행함 · ${esc(d.finding)}</p>`:`<button class="secondary" data-maint="${esc(k)}">정비 실행 · ${m.minutes}분</button>`}</div>`;}).join('')}<p class="muted">이상이 없으면 시간·비용만 쓰게 돼요. 항상 이득인 선택이 아니에요.</p></section>`;
}
export function bindOps(content,{global,act,newCampaignLot}){
  content.querySelector('#campaign-start')?.addEventListener('submit',e=>{e.preventDefault();const id=new FormData(e.currentTarget).get('order');if(id)newCampaignLot(String(id));});
  for(const b of content.querySelectorAll('[data-maint]'))b.addEventListener('click',()=>act({type:'campaign-maintenance',item:b.dataset.maint}));
  const form=content.querySelector('#campaign-close');
  form?.addEventListener('submit',e=>{e.preventDefault();const decision=e.submitter?.value,data=new FormData(form);
    if(decision==='scrap'&&data.get('scrapOk')!=='on'){const el=content.querySelector('#action-error');if(el)el.textContent='폐기하려면 확인 체크가 필요해요.';return;}
    global({type:'campaign-close',decision,acknowledgeNonconforming:data.get('ack')==='on'});});
}
