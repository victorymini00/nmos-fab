import {CAUSES,DISPOSITIONS,EVIDENCE_LABELS} from '../systems/incidents.js';
import {INCIDENT as I} from '../constants.js';
import {advisorSection,meetingSummary} from './advisorPanel.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v).toFixed(1);
const lastOf=(state,id)=>[...state.records].reverse().find(r=>r.operationId===id);
function evidenceList(state){
  const inc=state.incident,ref=lastOf(state,'metrology-reference'),log=lastOf(state,'incident-log');
  const item=(k,body)=>`<li class="${inc.evidence.includes(k)?'done':''}"><strong>${EVIDENCE_LABELS[k]}</strong> ${inc.evidence.includes(k)?body:'<span class="muted">아직 확인 안 함</span>'}</li>`;
  return `<ul class="evidence">${item('reference',ref?`기준 시료 평균 ${n(ref.result.meanNm)} nm (인증 ${n(ref.result.certifiedNm)}) · 편차 ${ref.result.offsetNm>=0?'+':''}${n(ref.result.offsetNm)} nm`:'')}${item('log',log?esc(log.result.note):'')}${item('map','측정 이력 표에서 지점별 값을 비교하세요')}</ul>`;
}
// 계측 장비 화면 위쪽에 붙는 퀘스트 영역
export function incidentSection(state){
  const inc=state.incident;if(!inc||inc.phase==='missed')return '';
  const head=`<div class="incident-head"><span>FAB INCIDENT · ${esc(inc.id)}</span><strong>${esc(inc.title)}</strong></div>`;
  if(inc.phase==='armed')return `<section class="incident armed">${head}<p>돌발 상황 퀘스트가 진행 중이에요. 이번 산화막 측정에서 무언가 이상할 수 있어요. 측정 지점은 신중하게 고르세요.</p></section>`;
  if(inc.phase==='alarm')return `<section class="incident alarm">${head}<p class="oos">OOS 경고 · 측정 결과가 규격을 벗어났어요</p><p>목표 ${n(inc.alarm.targetNm)} nm ±10% · 측정 평균 ${n(inc.alarm.meanNm)} nm${inc.alarm.outSites.length?` · 규격 밖 지점: ${inc.alarm.outSites.join(', ')}`:''}</p><p>원인을 모르는 상태에서 다음 Run 조건을 바꾸거나 그대로 진행하면 안 돼요. 먼저 Lot을 보류하고 조사하세요.</p><button id="incident-hold" class="primary">Lot HOLD · 원인 조사 시작</button></section>`;
  if(inc.phase==='hold')return `<section class="incident hold">${head}<p><strong>HOLD 중</strong> · 조사 시간 ${inc.minutes}분 (${I.freeInvestigationMinutes}분을 넘으면 감점)</p><p>아래 증거를 모아 원인을 가려내세요. 증거마다 시간이 들어요.</p><ul class="muted"><li>기준 시료 측정: 아래 계측 장비 상태에서 실행</li><li>산화로 공정 로그: 산화로로 이동해서 조회 (${I.logMinutes}분)</li><li>5점 두께 재측정: 아래 측정 지점 선택</li></ul>${evidenceList(state)}
    <form id="diagnose-form" class="diagnose"><fieldset><legend>원인 판정</legend>${Object.entries(CAUSES).map(([k,c])=>`<label class="check"><input type="radio" name="cause" value="${k}" required><span><strong>${c.label}</strong> · ${c.detail}</span></label>`).join('')}</fieldset><fieldset><legend>조치</legend>${Object.entries(DISPOSITIONS).map(([k,d])=>`<label class="check"><input type="radio" name="disposition" value="${k}" required>${d}</label>`).join('')}</fieldset><button class="primary">판정 제출 (한 번만 채점)</button></form>${advisorSection(state)}</section>`;
  const e=inc.evaluation,truth=CAUSES[inc.cause];
  const next=inc.disposition==='remeasure'?'계측 장비를 교정한 뒤 다시 측정해서 합격하면 서명하세요.':inc.disposition==='use-as-is'?'측정값이 규격 밖이어도 특채 확인 체크 후 서명할 수 있어요.':'이 Lot은 폐기했어요. Runsheet에서 새 Lot을 시작하세요.';
  return `<section class="incident resolved">${head}<div class="incident-score"><strong>${e.score}</strong><span>/ 100</span></div><p>실제 원인: <strong>${truth.label}</strong> · ${truth.detail}</p><ul class="evidence"><li class="${e.causeOk?'done':'miss'}">원인 판정 ${e.causeOk?'정답':`오답 (선택: ${CAUSES[inc.diagnosis].label})`}</li><li class="${e.bestDisposition?'done':e.dispositionOk?'':'miss'}">조치 ${e.bestDisposition?'최선':e.dispositionOk?'가능하지만 비용이 큼':'부적절'}</li><li class="${e.keyEvidenceFound?'done':'miss'}">핵심 증거(${EVIDENCE_LABELS[e.keyEvidence]}) ${e.keyEvidenceFound?'확인함':'확인 안 함'}</li><li>조사 시간 ${e.minutes}분</li><li>긴급 회의 ${e.meetings??0}회 (AI ${e.aiMeetings??0}회)</li></ul><p>${next}</p>${meetingSummary(state)}
    <details><summary>조치 변경</summary><form id="disposition-form">${Object.entries(DISPOSITIONS).map(([k,d])=>`<label class="check"><input type="radio" name="disposition" value="${k}" ${k===inc.disposition?'checked':''}>${d}</label>`).join('')}<button class="secondary">조치 변경 (점수는 그대로)</button></form></details>${inc.disposition==='scrap'?'<button id="new-incident-lot" class="secondary">퀘스트로 새 Lot 다시 시작</button>':''}</section>`;
}
export function furnaceLogSection(state){
  const inc=state.incident;if(!inc||!['hold','resolved'].includes(inc.phase))return '';
  const log=lastOf(state,'incident-log');
  return `<section class="incident hold"><div class="incident-head"><span>FAB INCIDENT · ${esc(inc.id)}</span><strong>산화로 공정 로그</strong></div>${log?`<p>레시피: ${log.result.temperatureC}°C · ${log.result.recipeMinutes}분 · ${log.result.ambient==='wet'?'습식':'건식'}<br>장비 기록: 실제 가동 ${n(log.result.actualMinutes)}분</p><p><strong>${esc(log.result.note)}</strong></p>`:'<p>온도·가스·단계 시간 기록을 조회해서 레시피대로 돌았는지 확인해요.</p>'}${inc.phase==='hold'?`<button id="inspect-log" class="${log?'secondary':'primary'}">공정 로그 조회 · ${I.logMinutes}분</button>`:''}</section>`;
}
export function incidentReport(state){
  const inc=state.incident;if(!inc)return '';
  if(inc.phase==='missed')return `<section class="incident alarm"><div class="incident-head"><span>FAB INCIDENT · ${esc(inc.id)}</span><strong>놓친 결함</strong></div><p>Field 산화막에 <strong>${CAUSES[inc.cause].label}</strong>이 있었지만, 측정에서 경고가 뜨지 않은 채 서명했어요. 일부 지점만 측정하면 국부 이상을 놓칠 수 있어요.</p></section>`;
  if(inc.phase!=='resolved')return '';
  const e=inc.evaluation;return `<section class="incident resolved"><div class="incident-head"><span>FAB INCIDENT · ${esc(inc.id)}</span><strong>퀘스트 결과 ${e.score} / 100</strong></div><p>실제 원인 ${CAUSES[inc.cause].label} · 판정 ${CAUSES[inc.diagnosis].label} (${e.causeOk?'정답':'오답'}) · 조치 ${DISPOSITIONS[inc.disposition]} · 증거 ${inc.evidence.map(k=>EVIDENCE_LABELS[k]).join(', ')||'없음'} · 조사 ${e.minutes}분</p></section>`;
}
export function bindIncident(content,{global,act,newIncidentLot}){
  content.querySelector('#incident-hold')?.addEventListener('click',()=>global({type:'incident-hold'}));
  content.querySelector('#inspect-log')?.addEventListener('click',()=>act({type:'inspect-log'}));
  content.querySelector('#diagnose-form')?.addEventListener('submit',e=>{e.preventDefault();const d=new FormData(e.currentTarget);global({type:'incident-diagnose',cause:d.get('cause'),disposition:d.get('disposition')});});
  content.querySelector('#disposition-form')?.addEventListener('submit',e=>{e.preventDefault();const d=new FormData(e.currentTarget);global({type:'incident-disposition',disposition:d.get('disposition')});});
  content.querySelector('#new-incident-lot')?.addEventListener('click',newIncidentLot);
}
