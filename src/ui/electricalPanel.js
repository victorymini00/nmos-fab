import {reportRows,signedElectrical} from '../systems/report.js';
import {ELECTRICAL as C} from '../constants.js';
import {reviewTable} from './metrologyPanel.js';
import {incidentReport} from './incidentPanel.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ma=v=>v===null?'산출불가':(v*1000).toFixed(3)+' mA';
export function curveSvg(result){
  const {curve,reference,conditions}=result;
  const max=Math.max(...reference.curve.map(p=>p.idA??0),...curve.map(p=>p.idA??0),1e-6)*1.12;
  const x=v=>70+(v-conditions.vgMinV)/(conditions.vgMaxV-conditions.vgMinV)*670;
  const y=i=>280-i/max*230;
  const path=points=>points.filter(p=>p.idA!==null).map(p=>`${x(p.vgV).toFixed(2)},${y(p.idA).toFixed(2)}`).join(' ');
  return `<svg class="iv-chart" viewBox="0 0 800 340" role="img" aria-label="게이트 전압 Vg에 따른 드레인 전류 Id. 기준 곡선과 공정 결과 비교">${Array.from({length:5},(_,i)=>{const a=max*i/4;return `<path d="M70 ${y(a)}H740" stroke="#dce8e9"/><text x="60" y="${y(a)+4}" text-anchor="end">${(a*1000).toFixed(2)}</text>`;}).join('')}<path d="M70 40V280H740" fill="none" stroke="#698990"/><polyline points="${path(reference.curve)}" stroke="#8b9ca5" stroke-width="3" stroke-dasharray="8 5" fill="none"/>${result.valid?`<polyline points="${path(curve)}" stroke="#128b7d" stroke-width="4" fill="none"/>`:'<text x="400" y="150" text-anchor="middle" fill="#9b4134">연결 불량: 유효 단자 곡선 산출불가</text>'}${[0,1,2,3.3].filter(v=>v>=conditions.vgMinV&&v<=conditions.vgMaxV).map(v=>`<text x="${x(v)}" y="305" text-anchor="middle">${v}</text>`).join('')}<text x="73" y="25">Id [mA] / Vds=${conditions.vdsV} V</text><text x="680" y="330">Vg [V]</text><text x="360" y="330">점선: 기준 / 실선: 공정 결과</text></svg>`;
}
export function reportTable(state,flow,layout){
  const rows=reportRows(state,flow,layout);
  return `<div class="table-scroll final-runsheet"><table><thead><tr>${['단계 / 작업','장비','목표 조건','실제 입력','계산 결과','계측 기록','확인 서명 / 시간'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr data-record-id="${r.recordId}">${r.cells.map(c=>`<td>${esc(c).replaceAll('\n','<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function exportToolbar(state){return `<div class="report-actions"><button id="export-pdf" class="primary" ${signedElectrical(state)?'':'disabled'}>전체 보고서 PDF 저장</button><button id="export-png" class="secondary" ${signedElectrical(state)?'':'disabled'}>전체 페이지 PNG 묶음 저장</button><span id="export-status" role="status">${signedElectrical(state)?'결과·곡선·전체 이력을 포함합니다.':'최종 확인 서명 후 저장할 수 있습니다.'}</span></div>`;}
export function electricalPanel(state,flow,layout){
  const r=state.electrical;
  if(!r)return `<section class="process-card"><h3>완성된 NMOS 전기적 테스트</h3><p>300 K · Vds=1 V · Vg=0~3.3 V</p><p>누적된 산화막·S/D·Gate·Contact·배선 상태를 기준 소자와 비교합니다. 장채널 제곱 법칙과 직렬 저항의 교육용 모델입니다.</p></section><button id="run-electrical" class="primary">Vt · Id–Vg 측정 실행</button><p id="action-error" class="error" role="alert"></p>`;
  const spec=r.specification;
  const confirmed=!!signedElectrical(state);
  return `<div class="test-summary"><div class="grade-card grade-${r.grade}"><span>최종 등급</span><strong>${r.grade}</strong><span>${r.score} / 100점</span></div><div class="test-metrics"><div><span>Vt (재료 모델)</span><strong>${r.vtV.toFixed(3)} V</strong><small>목표 ${r.reference.vtV.toFixed(3)} ±${spec.vtToleranceV} V</small><small>= Vfb ${r.vfbV.toFixed(3)} + 2φF ${(2*r.phiF).toFixed(3)} + Qd/Cox ${r.depletionV.toFixed(3)}</small></div><div><span>Ion @ Vg=${r.conditions.vgMaxV} V</span><strong>${ma(r.ionA)}</strong><small>목표 ${ma(r.reference.ionA)} ±${spec.ionToleranceFraction*100}%</small></div><div><span>총 직렬 저항${r.valid?'':' (참고값 · 연결 불량)'}</span><strong>${r.resistanceOhm.toFixed(1)} Ω</strong><small>기판 ${r.substrateCm3.toExponential(1)} cm⁻³ / Cox ${(r.coxFPerCm2*1e6).toFixed(3)} µF/cm²</small></div></div></div>${curveSvg(r)}
  ${r.vtV<C.lowVtWarningV?`<div class="result"><strong>Vt가 0 V 근처예요 (${r.vtV.toFixed(3)} V)</strong><p>n+ Poly 게이트와 p형 기판의 일함수 차이(φms ${r.phiMsV.toFixed(3)} V) 때문에 Vt가 낮아져서, 게이트 0 V에서도 완전히 꺼지지 않는 소자에 가까워요. 실제 공정에서는 채널에 붕소를 얕게 주입하는 <strong>Vt 조정 주입</strong>으로 Vt를 올립니다. 이 게임에는 아직 없는 공정이에요.</p></div>`:''}
  ${r.parameters.blockers.length?`<div class="result failure"><strong>유효 연결 경로의 결함</strong>${r.parameters.blockers.map(b=>`<p>${esc(b.text)}</p>`).join('')}<p>Vt는 재료 식으로 계산하지만, 연결 불량의 실제 단자 전류는 이 모델로 예측하지 않습니다.</p></div>`:''}
  ${incidentReport(state)}${reviewTable(state)}
  <section class="process-card"><h3>공정 영향 피드백</h3><p>${r.feedback[0].influence>1e-8?`가장 큰 모델 영향: <strong>${esc(r.feedback[0].label)}</strong>`:'기준 소자와 거의 동일합니다. 특정 공정의 큰 이탈이 없습니다.'}</p><p class="muted">한 그룹만 기준 파라미터로 되돌린 가상 비교입니다. 상대 영향은 물리적인 수율 확률이나 합산 가능한 인과 기여도가 아닙니다.</p>${r.feedback.map(f=>`<div class="influence-row"><strong>${esc(f.label)}</strong><span>${(f.relativeInfluence*100).toFixed(1)}%</span><i style="width:${Math.max(1,f.relativeInfluence*100)}%"></i><p>복원 시 ΔVt ${f.deltaVtV>=0?'+':''}${f.deltaVtV.toFixed(3)} V / ΔIon ${f.deltaIonA===null?'연결 유효성 변화':(f.deltaIonA*1000).toFixed(3)+' mA'}${f.blockerCount?' / 연결 결함 '+f.blockerCount+'건':''}<br>${esc(f.hint)}</p></div>`).join('')}</section>
  <details class="model-note"><summary>점수·모델·출처</summary><p>Vt 감점 ${r.deductions.vt.toFixed(1)} / 전류 ${r.deductions.current.toFixed(1)} / 균일도 ${r.deductions.uniformity.toFixed(1)} / 검사 ${r.deductions.inspections.toFixed(1)} / 재작업 ${r.deductions.rework.toFixed(1)}</p><p>S≥${spec.gradeCutoffs.S}, A≥${spec.gradeCutoffs.A}, B≥${spec.gradeCutoffs.B}. S/A는 목표 스펙 충족이 필요하며, 연결 불량·큰 스펙 이탈은 F입니다.</p>${r.limitations.map(t=>`<p>${esc(t)}</p>`).join('')}<a href="https://iic-jku.github.io/design-complex-ic/slides/mosfet.html" target="_blank" rel="noopener">MOS 전기적 모델 출처</a></details>
  ${confirmed?'<div class="result success">최종 확인 서명 완료 · 아래에 전체 Runsheet를 표시합니다.</div>':`<form id="sign-form">${r.grade==='F'?'<label class="check"><input name="acknowledge" type="checkbox" required>F 등급과 결함 피드백을 확인했습니다.</label>':''}<label>최종 확인 서명<input name="signature" maxlength="32" required placeholder="공정 엔지니어 이름"></label><button class="primary">결과 확인 · 최종 서명</button></form>`}
  ${exportToolbar(state)}<h3>전체 Runsheet · ${state.records.length}개 기록</h3>${reportTable(state,flow,layout)}<p id="action-error" class="error" role="alert"></p>`;
}
