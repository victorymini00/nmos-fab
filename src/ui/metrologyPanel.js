import {METROLOGY as M} from '../constants.js';
import {SITE_NAMES,describeMeasurement,metrologyReview} from '../systems/metrology.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v).toFixed(1);
// 웨이퍼 위 측정 지점 좌표(SVG). 이름 순서는 SITE_NAMES(중앙·북·동·남·서).
const POS={'중앙':[100,100],'북':[100,42],'동':[158,100],'남':[100,158],'서':[42,100]};
export function waferMap(measurement,selectable=false){
  const values=Object.fromEntries((measurement?.observed??[]).map(o=>[o.name,o.valueNm]));
  return `<svg class="wafer-map" viewBox="0 0 200 200" role="img" aria-label="웨이퍼 측정 지점 지도"><circle cx="100" cy="100" r="88" fill="#e9f1f3" stroke="#8aa9b0" stroke-width="2"/><path d="M92 188h16" stroke="#8aa9b0" stroke-width="4"/>${SITE_NAMES.map(name=>{const [x,y]=POS[name],v=values[name];
    return `<g class="site${v!==undefined?' measured':''}" data-site="${name}"${selectable?' tabindex="0" role="checkbox" aria-checked="true"':''}><circle cx="${x}" cy="${y}" r="19"/><text x="${x}" y="${y-2}" text-anchor="middle">${name}</text><text x="${x}" y="${y+11}" text-anchor="middle" class="v">${v!==undefined?n(v):'—'}</text></g>`;}).join('')}</svg>`;
}
export function toolStatus(state){
  const m=state.metrology,log=state.records.filter(r=>r.operationId==='metrology-reference'||r.operationId==='metrology-calibration').slice(-4).reverse();
  return `<section class="process-card tool-card"><h3>계측 장비 상태</h3><p>마지막 교정 이후 측정 ${m.sitesSinceCalibration}점 · 누적 계측 시간 ${m.minutes}분 · 기준 시료 확인 ${m.referenceChecks}회 · 교정 ${m.calibrations}회</p><p class="muted">장비는 측정할수록 편향(드리프트)이 조금씩 쌓여요. 편향은 직접 보이지 않으니, 인증값을 아는 기준 시료(SiO₂ ${M.referenceNm.toFixed(1)} nm ±${M.referenceUncertaintyNm})를 재서 확인하세요.</p>
  <div class="tool-actions"><button id="check-reference" class="secondary">기준 시료 측정 · ${M.referenceMinutes}분</button><button id="calibrate" class="secondary">장비 교정 · ${M.calibrationMinutes}분</button></div>
  ${log.length?`<ul class="tool-log">${log.map(r=>r.result.kind==='metrology-calibration'?'<li>교정 완료 · 편향 초기화</li>':`<li>기준 시료 ${r.result.readings.map(n).join(' / ')} nm → 평균 ${n(r.result.meanNm)} nm · 편차 <strong>${r.result.offsetNm>=0?'+':''}${n(r.result.offsetNm)} nm</strong></li>`).join('')}</ul>`:''}</section>`;
}
export function metrologyPanel(state,op,record,signForm){
  const latest=record?.measurement,history=record?.measurements??[];
  const tolerance=op.modelId==='deposit'?`평균 ±10% · 비균일도 ≤${(record?.result?.uniformityLimit*100||0).toFixed(0)}%`:`평균 ±${op.thicknessToleranceFraction*100}%`;
  let html=`<section class="process-card"><h3>${op.modelId==='deposit'?'막 두께·균일도 측정':'산화막 두께 측정'}</h3><p>측정값에는 장비의 반복 오차와 편향이 섞여 있어요. 실제 두께는 Lot이 끝난 뒤 사후 분석에서 공개됩니다.</p><p class="muted">합격 기준: ${tolerance}${record?.result?.targetNm?` · 목표 ${n(record.result.targetNm)} nm`:''}. 1점 측정은 빠르지만 균일도를 판단할 수 없어요. 지점당 ${M.minutesPerSite}분.</p></section>`;
  if(!record)return html+'<p class="result">지정된 장비에서 공정을 먼저 실행하세요.</p>'+toolStatus(state);
  html+=`<div class="metrology-grid"><div>${waferMap(latest,true)}</div><div><form id="measure-form"><fieldset class="site-picker"><legend>측정 지점 선택</legend>${SITE_NAMES.map(s=>`<label class="check"><input type="checkbox" name="site" value="${s}" checked>${s}</label>`).join('')}</fieldset><button id="measure" class="primary">선택 지점 측정</button></form>
    ${latest?`<div class="result ${latest.pass?'success':'failure'}"><strong>${latest.pass?'측정 기준 합격':'측정 기준 불합격'}</strong><p>${esc(describeMeasurement(latest)).replaceAll('\n','<br>')}</p></div>`:'<p class="muted">아직 측정하지 않았어요.</p>'}</div></div>`;
  if(history.length>1)html+=`<details class="model-note" open><summary>측정 이력 ${history.length}회</summary><table class="mini-table"><thead><tr><th>#</th><th>지점별 값 [nm]</th><th>평균</th><th>비균일도</th><th>판정</th></tr></thead><tbody>${history.map((m,i)=>`<tr><td>${i+1}</td><td>${m.observed.map(o=>`${o.name} ${n(o.valueNm)}`).join(' · ')}</td><td>${n(m.meanNm)}</td><td>${m.nonuniformity===null?'—':(m.nonuniformity*100).toFixed(2)+'%'}</td><td>${m.pass?'합격':'불합격'}</td></tr>`).join('')}</tbody></table></details>`;
  if(latest)html+=latest.pass||op.acceptDefects?signForm(!latest.pass):'<p>측정 기준을 만족하지 못했어요. 재측정·장비 확인으로 원인을 가리거나, 공정 장비에서 재작업하세요.</p>';
  return html+toolStatus(state);
}
export function bindMetrology(content,act){
  const form=content.querySelector('#measure-form');if(!form)return;
  const sync=()=>{for(const g of content.querySelectorAll('.wafer-map .site')){const box=form.querySelector(`input[value="${g.dataset.site}"]`);g.classList.toggle('off',!box.checked);g.setAttribute('aria-checked',String(box.checked));}
    const k=form.querySelectorAll('input[name=site]:checked').length;form.querySelector('#measure').textContent=k?`선택 지점 ${k}곳 측정 · ${k*M.minutesPerSite}분`:'지점을 선택하세요';form.querySelector('#measure').disabled=!k;};
  for(const g of content.querySelectorAll('.wafer-map .site')){const toggle=()=>{const box=form.querySelector(`input[value="${g.dataset.site}"]`);box.checked=!box.checked;sync();};g.addEventListener('click',toggle);g.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();toggle();}});}
  form.addEventListener('change',sync);sync();
  form.addEventListener('submit',e=>{e.preventDefault();act({type:'measure',sites:[...form.querySelectorAll('input[name=site]:checked')].map(b=>b.value)});});
}
export function bindToolActions(content,act){
  content.querySelector('#check-reference')?.addEventListener('click',()=>act({type:'check-reference'}));
  content.querySelector('#calibrate')?.addEventListener('click',()=>act({type:'calibrate'}));
}
export function reviewTable(state){
  const rows=metrologyReview(state);if(!rows.length)return '';
  return `<section class="process-card"><h3>사후 분석: 측정값 vs 실제 값</h3><p class="muted">공정 중에는 보이지 않던 실제 값(모델 참값)을 공개합니다. 오차 = 측정 평균 − 실제 평균. 누적 계측 시간 ${state.metrology.minutes}분 · 교정 ${state.metrology.calibrations}회.</p><table class="mini-table"><thead><tr><th>공정</th><th>측정 평균</th><th>실제 평균</th><th>오차</th><th>비균일도 측정 / 실제</th><th>측정 지점</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.stageTitle)}</td><td>${n(r.measuredMeanNm)}</td><td>${n(r.trueMeanNm)}</td><td>${r.errorNm>=0?'+':''}${r.errorNm.toFixed(2)}</td><td>${r.measuredNonuniformity===null?'판단 불가':(r.measuredNonuniformity*100).toFixed(2)+'%'} / ${(r.trueNonuniformity*100).toFixed(2)}%</td><td>${r.sites}점</td></tr>`).join('')}</tbody></table></section>`;
}
// 화면에 보여도 되는 두께: 각 공정의 최신 측정 평균(참값 아님)
export function knownThickness(state){
  const out={};for(const r of state.records){if(r.superseded||!r.measurement?.metrology)continue;
    const key={'field-oxidation':'field','gate-oxidation':'gate','poly-deposition':'poly','ild-deposition':'ild','al-deposition':'metal'}[r.operationId];if(key)out[key]=r.measurement.meanNm;}
  return out;
}
