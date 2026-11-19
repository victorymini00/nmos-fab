import {CAUSES,CHECKS,DISPOSITIONS,causeStatus,ID} from '../systems/incident002.js';
import {INCIDENT2 as Q} from '../constants.js';
import {advisorSection,meetingSummary} from './advisorPanel.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS={unverified:['미확인','st-unverified'],confirmed:['확인됨','st-confirmed'],'ruled-out':['배제됨','st-ruled']};
const head=inc=>`<div class="incident-head"><span>FAB INCIDENT · ${esc(inc.id)}</span><strong>${esc(inc.title)}</strong></div>`;
function checkResult(c){
  const r=c.result;
  if(c.kind==='history')return `<ul class="mini-list">${r.lines.map(l=>`<li>${esc(l.step)}: ${l.inspected?(l.pass?'합격':'불합격/결함 인지'):'기록 없음'}${l.maxResidualNm!=null?` · 잔류 최대 ${Number(l.maxResidualNm).toFixed(1)} nm`:''}${l.defectPct!=null?` · 박리 ${l.defectPct}%`:''}</li>`).join('')}</ul><p class="muted">${esc(r.note)}</p>`;
  return `<p>${esc(r.reading)}</p>`;
}
function board(inc){
  const st=causeStatus(inc);
  return `<div class="cause-board"><p class="board-title">원인 확인 상태 <span class="muted">(초기 OPEN 증상만으로는 셋을 구분할 수 없어요)</span></p>${Object.entries(CAUSES).map(([k,c])=>`<div class="cause ${STATUS[st[k]][1]}"><strong>${c.label}</strong><span>${STATUS[st[k]][0]}</span></div>`).join('')}</div>`;
}
function timeline(inc){
  if(!inc.checks.length)return '<p class="muted">아직 추가 검사를 하지 않았어요.</p>';
  return `<ol class="check-log">${inc.checks.map(c=>`<li class="${c.unnecessary?'unnecessary':''}"><strong>${esc(CHECKS[c.kind].label)}</strong> · ${c.minutes}분${c.afterDiagnosis?' · 판정 후':''}${c.unnecessary?' · <span class="warn">불필요(이미 확인된 뒤 또는 반복)</span>':''}${checkResult(c)}</li>`).join('')}</ol>`;
}
function checkButtons(inc){
  return `<div class="check-grid">${Object.entries(CHECKS).map(([k,c])=>`<button type="button" class="secondary check-btn" data-check="${k}"><strong>${c.label}</strong><span>${c.detail}</span><em>${Q.minutes[k]}분${inc.checks.some(x=>x.kind===k)?' · 이미 함':''}</em></button>`).join('')}</div>`;
}
export function incident002Section(state){
  const inc=state.incident;if(inc?.id!==ID||inc.phase==='armed')return '';
  if(inc.phase==='alarm')return `<section class="incident alarm">${head(inc)}<p class="oos">OPEN 감지 · 단자 전류가 측정 하한(${Q.currentFloorA} A) 미만</p><p>모든 공정 검사는 합격했는데 최종 소자에서 전류가 측정되지 않았어요. <strong>진단 미완료</strong> 상태예요. 원인은 소자 내부일 수도, 측정 장비일 수도 있어요.</p><button id="incident-hold" class="primary">Lot HOLD · 원인 조사 시작</button></section>`;
  if(inc.phase==='hold')return `<section class="incident hold">${head(inc)}<p><strong>HOLD 중 · 진단 미완료</strong> · 조사 시간 ${inc.minutes}분 (${Q.freeMinutes}분을 넘으면 감점)</p>${board(inc)}
    <h4>추가 검사 (2D 패널 · 교육용 모델, 검증 필요)</h4>${checkButtons(inc)}<h4>조사 기록</h4>${timeline(inc)}
    <form id="diagnose-form" class="diagnose"><fieldset><legend>원인 판정</legend>${Object.entries(CAUSES).map(([k,c])=>`<label class="check"><input type="radio" name="cause" value="${k}" required><span><strong>${c.label}</strong> · ${c.detail} <em class="muted">(${STATUS[causeStatus(inc)[k]][0]})</em></span></label>`).join('')}</fieldset>
    <fieldset><legend>조치</legend>${Object.entries(DISPOSITIONS).map(([k,d])=>`<label class="check"><input type="radio" name="disposition" value="${k}" required>${d}</label>`).join('')}</fieldset><p class="muted">'미확인' 원인으로 판정하면 근거 없는 판정으로 기록돼요. 판정 뒤에도 조치와 검증을 마쳐야 퀘스트가 끝나요.</p><button class="primary">판정 제출 (한 번만 채점)</button></form>${advisorSection(state)}</section>`;
  if(inc.phase==='action'){
    const d=inc.disposition,done=!!inc.action,fail=inc.verification&&!inc.verification.ok;
    const verifyBtn=d==='reseat-retest'?'<button id="incident2-retest" class="primary">전기적 테스트 재측정 · 검증</button>':'<button id="incident2-verify" class="primary">조치 검증 실행</button>';
    return `<section class="incident hold">${head(inc)}<p><strong>판정 완료 · 조치와 검증 필요</strong> · 판정: ${CAUSES[inc.diagnosis].label} (판정 시 상태: ${STATUS[inc.diagnosisBasis.status][0]}) · 조사 ${inc.minutes}분</p>
    <ol class="steps"><li class="${done?'done':''}">조치: ${DISPOSITIONS[d]} ${done?'· 완료':`<button id="incident2-act" class="primary">조치 실행 · ${Q.minutes.action[d]}분</button>`}</li><li>검증: ${d==='reseat-retest'?'재측정에서 정상 곡선이 나와야 함':'원인 검사로 개선 대상 공정이 맞는지 확인'} ${done?verifyBtn:''}</li></ol>
    ${fail?`<div class="result failure"><strong>검증 실패</strong><p>${esc(inc.verification.note)}</p><p>조치를 바꾸거나 추가 검사를 해보세요. 이미 끊긴 배선·Contact는 버튼으로 복구되지 않아요.</p></div>`:''}
    <details ${fail?'open':''}><summary>조치 변경</summary><form id="disposition-form">${Object.entries(DISPOSITIONS).map(([k,x])=>`<label class="check"><input type="radio" name="disposition" value="${k}" ${k===d?'checked':''}>${x}</label>`).join('')}<button class="secondary">조치 변경 (판정 점수는 그대로)</button></form></details>
    <details><summary>추가 검사</summary>${checkButtons(inc)}</details><h4>조사 기록</h4>${timeline(inc)}</section>`;
  }
  return closedSummary(state);
}
export function closedSummary(state){
  const inc=state.incident;if(inc?.id!==ID||inc.phase!=='closed')return '';const e=inc.evaluation;
  return `<section class="incident resolved">${head(inc)}<div class="incident-score"><strong>${e.score}</strong><span>/ 100</span></div><p>실제 원인: <strong>${CAUSES[inc.cause].label}</strong> · ${CAUSES[inc.cause].detail}</p>
  <ul class="evidence"><li class="${e.causeOk?'done':'miss'}">원인 판정 ${e.causeOk?'정답':`오답 (선택: ${CAUSES[inc.diagnosis].label})`} · 판정 당시 상태 ${STATUS[e.diagnosisStatus][0]}</li>
  <li class="${e.keyEvidenceFound?'done':'miss'}">핵심 근거(${CHECKS[e.keyEvidence].label}) ${e.keyEvidenceFound?'판정 전에 확인함':'판정 전에 확인 안 함'}</li>
  <li class="${e.bestDisposition?'done':'miss'}">조치 ${DISPOSITIONS[inc.disposition]} · ${e.bestDisposition?'원인에 맞음':'원인에 맞지 않음'}</li>
  <li class="${e.verificationAttempts===1?'done':''}">검증 ${e.verificationAttempts}회 만에 완료 · ${esc(inc.verification.note)}</li>
  <li class="${e.unnecessaryChecks?'miss':'done'}">불필요한 검사 ${e.unnecessaryChecks}회 · 조사 시간 ${e.minutes}분 · 긴급 회의 ${e.meetings}회 (AI ${e.aiMeetings}회) · 실험 조건 ${inc.mode==='no-ai'?'AI 미사용':'AI 회의 사용'}${inc.participant?` · ${esc(inc.participant)}`:''}</li></ul>
  <h4>조사 순서</h4>${timeline(inc)}${meetingSummary(state)}<p class="muted">검사 모델·저항값·시간·배점은 교육용 설정이며 실제 테스트 장비를 재현하지 않아요(검증 필요).</p></section>`;
}
export function bindIncident002(content,{global,act}){
  for(const b of content.querySelectorAll('.check-btn'))b.addEventListener('click',()=>act({type:'incident2-check',check:b.dataset.check}));
  content.querySelector('#incident2-act')?.addEventListener('click',()=>act({type:'incident2-act'}));
  content.querySelector('#incident2-verify')?.addEventListener('click',()=>act({type:'incident2-verify'}));
  content.querySelector('#incident2-retest')?.addEventListener('click',()=>act({type:'execute'}));
}
