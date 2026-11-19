import {LAB,VARIABLES,FIXED_ON_CLONE,NEW_ON_RUN,saveBaseline,startSession,runExperiment,selectBest,runConfirmation,endSession,publicRun,reveal,labCsv,changedVariables,processMinutes} from '../systems/processLab.js';
import {SITE_NAMES} from '../systems/metrology.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(v,d=1)=>v===null||v===undefined?'—':Number(v).toFixed(d);
const KEY='nmos-fab-process-lab';
export function loadLab(create){try{const v=JSON.parse(localStorage.getItem(KEY)??'null');return v?.version===1?v:create();}catch{return create();}}
export function saveLab(lab){try{localStorage.setItem(KEY,JSON.stringify(lab));return true;}catch{return false;}}
const G=LAB.goal;
const STATUS={met:['목표 충족','ok'],fail:['목표 미달','bad'],insufficient:['판정 보류 (측정 부족)','hold']};
const UNI={confirmed:'5지점 확정',partial:'부분 측정 · 전체 균일도 미확정',unknown:'1점 측정 · 균일도 판단 불가'};
function goalBox(){return `<div class="target-box"><strong>목표 (process_lab.json · 교육용, 검증 필요)</strong><p>평균 두께 ${G.targetThicknessNm} nm ±${G.thicknessTolerancePct}% · 비균일도 ≤${G.maxNonuniformityPct}% (${G.minSitesForUniformity}지점 측정 필수) · ${esc(G.objective)}</p><p class="muted">처리시간 = 증착 시간 + 준비 ${LAB.processTime.fixedOverheadMinutes}분 + 온도 안정화(편차를 ${LAB.processTime.stabilizationReferenceSpreadC}°C보다 1°C 줄일 때마다 ${LAB.processTime.stabilizationMinutesPerC}분 · 구역 온도를 맞추는 시간이 더 든다고 가정). 측정 시간은 따로 기록해요.</p></div>`;}
function chart(runs){
  if(!runs.length)return '';
  const W=300,H=180,pad=36,xs=i=>pad+(i+.5)*(W-pad-10)/runs.length;
  const panel=(title,vals,lo,hi,band,limit,fmt,ox,partial)=>{const y=v=>H-24-(v-lo)/(hi-lo||1)*(H-48);
    return `<g transform="translate(${ox},0)"><text x="${pad}" y="14" class="ct">${title}</text><path d="M${pad} 24V${H-24}H${W-6}" class="ax"/>${band?`<rect x="${pad}" y="${y(band[1])}" width="${W-pad-6}" height="${Math.max(1,y(band[0])-y(band[1]))}" class="band"/>`:''}${limit!==null?`<path d="M${pad} ${y(limit)}H${W-6}" class="lim"/>`:''}
    ${[lo,hi].map(v=>`<text x="${pad-4}" y="${y(v)+4}" text-anchor="end" class="tk">${fmt(v)}</text>`).join('')}
    ${vals.map((v,i)=>v===null?`<text x="${xs(i)}" y="${H-30}" text-anchor="middle" class="tk">미확정</text>`:`<circle cx="${xs(i)}" cy="${y(v)}" r="6" class="${partial[i]?'pt hollow':'pt'}"/>`).join('')}
    ${runs.map((r,i)=>`<text x="${xs(i)}" y="${H-8}" text-anchor="middle" class="tk">${r.kind==='confirmation'?'확인':r.index}</text>`).join('')}</g>`;};
  const th=runs.map(r=>r.measurement.meanNm),un=runs.map(r=>r.goal.uniformityStatus==='confirmed'?r.measurement.nonuniformity*100:null),tm=runs.map(r=>r.processMinutes);
  const tol=G.targetThicknessNm*G.thicknessTolerancePct/100,partial=runs.map(r=>r.goal.uniformityStatus!=='confirmed');
  const tLo=Math.min(...th,G.targetThicknessNm-tol)-5,tHi=Math.max(...th,G.targetThicknessNm+tol)+5,uHi=Math.max(G.maxNonuniformityPct*1.5,...un.filter(v=>v!==null))+.5,mHi=Math.max(...tm)+5;
  return `<svg class="lab-chart" viewBox="0 0 ${W*3} ${H}" role="img" aria-label="실험별 측정 평균 두께, 비균일도, 처리시간 비교">${panel('측정 평균 두께 [nm] · 띠=허용범위',th,tLo,tHi,[G.targetThicknessNm-tol,G.targetThicknessNm+tol],null,v=>v.toFixed(0),0,partial)}${panel(`관측 비균일도 [%] · 선=${G.maxNonuniformityPct}%`,un,0,uHi,null,G.maxNonuniformityPct,v=>v.toFixed(1),W,partial)}${panel('처리시간 [분] · 낮을수록 좋음',tm,0,mHi,null,null,v=>v.toFixed(0),W*2,runs.map(()=>false))}</svg><p class="muted">빈 원은 5지점 미만으로 측정한 실험이에요. 그 실험의 비균일도는 전체 웨이퍼 값으로 확정하지 않아 그리지 않았어요.</p>`;
}
function table(session){
  const rows=[...session.runs,...(session.confirmation?[session.confirmation]:[])].map(publicRun);
  if(!rows.length)return '<p class="muted">아직 실험이 없어요.</p>';
  return `<div class="table-scroll"><table class="mini-table lab-table"><thead><tr><th>#</th><th>온도 / 시간 / 편차</th><th>바꾼 변수</th><th>측정 위치·두께 [nm]</th><th>측정 평균</th><th>관측 비균일도</th><th>처리시간</th><th>예상 → 관측</th><th>판정</th></tr></thead><tbody>${rows.map(r=>{const m=r.measurement,s=STATUS[r.goal.status];
    return `<tr class="${session.selectedBest===r.index&&r.kind==='experiment'?'best':''}"><td>${r.kind==='confirmation'?`확인<br><small>실험 ${r.fromIndex}</small>`:r.index}</td><td>${r.input.temperatureC}°C / ${r.input.minutes}분 / ${r.input.zoneSpreadC}°C</td>
    <td>${r.kind==='confirmation'?'—':r.changed.length?r.changed.map(k=>VARIABLES[k].label).join(', ')+`<br><small>${esc(r.changedFrom)} 대비</small>`+(r.changed.length>1?'<br><span class="warn">2개 이상 변경</span>':''):'없음 (재현)'}</td>
    <td>${m.observed.map(o=>`${o.name} ${n(o.valueNm)}`).join('<br>')}</td><td>${n(m.meanNm)}</td><td>${m.nonuniformity===null?'—':n(m.nonuniformity*100,2)+'%'}<br><small>${UNI[r.goal.uniformityStatus]}</small></td><td>${n(r.processMinutes)}분<br><small>측정 ${m.minutes}분 별도</small></td>
    <td>${r.prediction?`${n(r.prediction.meanNm)} → ${n(m.meanNm)} nm<br>${n(r.prediction.nonuniformityPct,2)} → ${m.nonuniformity===null?'미확정':n(m.nonuniformity*100,2)}%<br><small>${esc(r.prediction.reason)}</small>`:'—'}</td><td class="st-${s[1]}">${s[0]}${r.kind==='confirmation'?`<br><strong>${r.reproduced?'재현됨':'재현 안 됨'}</strong>`:''}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function form(lab){
  const s=lab.session,base=lab.baselines.find(b=>b.id===s.baselineId),last=s.runs.at(-1)?.input??base.recipe,full=s.runs.length>=LAB.limits.maxExperiments;
  if(full)return `<p class="result">실험 ${LAB.limits.maxExperiments}개를 모두 썼어요. 가장 좋은 조건을 골라 확인 Run을 하세요.</p>`;
  return `<form id="lab-run" class="lab-form"><h4>실험 ${s.runs.length+1} 설계</h4><p class="muted">${s.runs.length<3?'<strong>처음에는 한 번에 한 변수만 바꿔 보세요.</strong> 여러 개를 바꾸면 어떤 변수가 결과를 바꿨는지 구분하기 어려워요.':'여러 변수를 함께 바꾸면 효과가 섞인다는 점을 기록해 두세요.'} 기준값은 ${esc(s.runs.length?`실험 ${s.runs.length}`:'기준 Run')} 조건이에요.</p>
  <div class="form-grid">${Object.entries(VARIABLES).map(([k,v])=>`<label>${v.label} [${v.unit}]<input name="${k}" type="number" step="any" min="${LAB.limits[k][0]}" max="${LAB.limits[k][1]}" value="${last[k]}" data-ref="${last[k]}"></label>`).join('')}</div>
  <p id="lab-changed" class="muted"></p>
  <fieldset class="site-picker"><legend>측정 위치</legend>${SITE_NAMES.map(x=>`<label class="check"><input type="checkbox" name="site" value="${x}" checked>${x}</label>`).join('')}</fieldset>
  <fieldset class="predict"><legend>실행 전 예상 (필수)</legend><div class="form-grid"><label>예상 평균 두께 [nm]<input name="pMean" type="number" step="any" required></label><label>예상 비균일도 [%]<input name="pUni" type="number" step="any" min="0" required></label><label>예상 처리시간<input id="lab-ptime" disabled></label></div><label>이유 (무엇을 확인하려는 실험인지)<input name="reason" maxlength="300" required placeholder="예: 온도만 올리면 증착률은 오르지만 균일도가 나빠지는지 확인"></label></fieldset>
  <button class="primary">실험 실행 · 측정</button></form>`;
}
function bestBox(s){
  const met=s.runs.filter(r=>r.goal.status==='met');
  if(!met.length)return '<p class="muted">5지점 측정으로 목표를 충족한 실험이 생기면 가장 좋은 조건을 고를 수 있어요.</p>';
  const c=s.confirmation;
  return `<section class="process-card"><h4>가장 좋은 조건 고르기 → 확인 Run</h4><p class="muted">이번 비교 범위 안에서 고른 조건일 뿐, 전역 최적 조건이라는 뜻은 아니에요. 같은 조건으로 새 Run을 한 번 더 돌려 재현되는지 확인해요.</p>
  <form id="lab-best">${met.map(r=>`<label class="check"><input type="radio" name="best" value="${r.index}" ${s.selectedBest===r.index?'checked':''}>실험 ${r.index} · ${r.input.temperatureC}°C / ${r.input.minutes}분 / ${r.input.zoneSpreadC}°C · 처리시간 ${n(r.processMinutes)}분</label>`).join('')}<button class="secondary">선택</button></form>
  ${s.selectedBest&&!c?'<button id="lab-confirm" class="primary">확인 Run 실행 (같은 조건 · 새 Run · 5지점 측정)</button>':''}
  ${c?`<div class="result ${c.reproduced?'success':'failure'}"><strong>확인 Run: ${c.reproduced?'목표 재현됨':'목표 재현 안 됨'}</strong><p>측정 평균 ${n(c.measurement.meanNm)} nm · 비균일도 ${n(c.measurement.nonuniformity*100,2)}% · 처리시간 ${n(c.processMinutes)}분</p><p class="muted">${c.reproduced?'한 번 더 재현됐지만, Run 수가 적어 공정 능력(산포)을 확정할 수는 없어요.':'실험 때는 충족했지만 새 Run에서 재현되지 않았어요. Run마다 산포가 있어서 여유가 작은 조건은 위험해요.'}</p></div>`:''}</section>`;
}
function revealBox(s){
  const rows=reveal(s);
  return `<section class="process-card"><h3>사후 분석: 관측값 vs 실제 값</h3><p class="muted">실험 중 숨겼던 실제 두께(공정 참값)와 Run 산포를 공개해요. 관측값에는 계측 오차가, 실제 값에는 Run 산포가 들어 있어요.</p><table class="mini-table"><thead><tr><th>Run</th><th>관측 평균</th><th>실제 평균</th><th>관측 비균일도</th><th>실제 비균일도</th><th>측정 지점</th><th>Run 증착률 배수</th><th>실제 기준 판정</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${n(r.observedMeanNm)}</td><td>${n(r.trueMeanNm)}</td><td>${r.observedNonuniformity===null?'—':n(r.observedNonuniformity*100,2)+'%'}</td><td>${n(r.trueNonuniformity*100,2)}%</td><td>${r.sites}점</td><td>${n(r.rateFactor,3)}</td><td>${STATUS[r.trueGoal][0]}</td></tr>`).join('')}</tbody></table></section>`;
}
export function labView(lab,state,flow,completed){
  const s=lab.session,saved=lab.baselines.some(b=>b.runKey===`${state.lotId}|${state.records[0]?.executedAt}`),canSave=completed&&!saved;
  let html=`<p class="muted">Poly LPCVD 한 공정만 비교해요. 원본 Lot과 기존 Runsheet는 바뀌지 않아요. 모든 모델·계수는 교육용이며 검증 필요.</p>${goalBox()}
  <section class="process-card"><h3>기준 Run (읽기 전용)</h3>${lab.baselines.length?`<ul class="mini-list">${lab.baselines.map(b=>`<li><label class="check"><input type="radio" name="baseline" value="${b.id}" ${s?.baselineId===b.id?'checked':''}><span><strong>${b.id}</strong> · ${esc(b.lotId)} · 저장 ${new Date(b.savedAt).toLocaleString('ko-KR')} · 레시피 ${b.recipe.temperatureC}°C / ${b.recipe.minutes}분 / ${b.recipe.zoneSpreadC}°C · 측정 평균 ${n(b.observed.meanNm)} nm${b.observed.nonuniformity!==null?` · 비균일도 ${n(b.observed.nonuniformity*100,2)}%`:''}</span></label></li>`).join('')}</ul>`:'<p class="muted">저장된 기준 Run이 없어요.</p>'}
  <div class="tool-actions"><button type="button" id="lab-save-baseline" class="secondary" ${canSave?'':'disabled'}>현재 완료 Run을 기준으로 저장</button><button type="button" id="lab-start" class="primary" ${lab.baselines.length&&(!s||s.ended)?'':'disabled'}>선택한 기준 Run으로 새 실험 세션</button></div>
  ${canSave?'':`<p class="muted">${saved?'현재 Run은 이미 기준으로 저장했어요.':'기준으로 저장하려면 현재 Lot을 전기적 테스트 서명까지 완료하세요.'}</p>`}
  <details><summary>복제할 때 고정되는 것 / Run마다 새로 정해지는 것</summary><p><strong>고정</strong></p><ul class="mini-list">${FIXED_ON_CLONE.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p><strong>새로 정해짐</strong></p><ul class="mini-list">${NEW_ON_RUN.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="muted">공정 산포 크기: 증착률 1σ ${LAB.runToRun.rateSigma*100}% · 위치별 편차 배수 1σ ${LAB.runToRun.uniformitySigma*100}% (교육용).</p></details></section>`;
  if(s){
    html+=`<section class="process-card lab-session"><h3>세션 ${esc(s.id)} · 기준 ${esc(s.baselineId)}${s.ended?' · 종료됨':''}</h3><p class="muted">실험 ${s.runs.length}/${LAB.limits.maxExperiments} · 세션 계측 시간 ${s.metrology.minutes}분</p>${chart([...s.runs,...(s.confirmation?[s.confirmation]:[])].map(publicRun))}${table(s)}
    ${s.ended?revealBox(s):`${form(lab)}${bestBox(s)}<div class="tool-actions"><button type="button" id="lab-end" class="secondary">실험 종료 · 사후 분석 공개</button></div>`}
    <div class="tool-actions"><button type="button" id="lab-csv" class="secondary" ${s.runs.length?'':'disabled'}>비교 결과·실험 의도 CSV 내려받기</button></div></section>`;
  }
  return html+'<p id="lab-error" class="error" role="alert"></p>';
}
export function bindLab(content,{getLab,setLab,getState,flow}){
  const err=content.querySelector('#lab-error'),now=()=>new Date().toISOString();
  const run=fn=>{try{setLab(fn(getLab()));}catch(e){if(err)err.textContent=e.message;}};
  content.querySelector('#lab-save-baseline')?.addEventListener('click',()=>run(l=>saveBaseline(l,getState(),flow,now())));
  content.querySelector('#lab-start')?.addEventListener('click',()=>{const id=content.querySelector('input[name=baseline]:checked')?.value;run(l=>startSession(l,id,now()));});
  const f=content.querySelector('#lab-run');
  if(f){const sync=()=>{const input=Object.fromEntries(Object.keys(VARIABLES).map(k=>[k,Number(f.elements[k].value)])),ref=Object.fromEntries(Object.keys(VARIABLES).map(k=>[k,Number(f.elements[k].dataset.ref)]));
      const ch=changedVariables(input,ref);content.querySelector('#lab-changed').innerHTML=ch.length?`바꾼 변수: ${ch.map(k=>VARIABLES[k].label).join(', ')}${ch.length>1?' · <span class="warn">2개 이상 바뀌었어요. 효과가 섞여요.</span>':''}`:'바꾼 변수 없음 (같은 조건 재현 실험)';
      try{content.querySelector('#lab-ptime').value=`${processMinutes(input).toFixed(1)}분`;}catch{}};
    f.addEventListener('input',sync);sync();
    f.addEventListener('submit',e=>{e.preventDefault();const d=new FormData(f);
      run(l=>runExperiment(l,{input:Object.fromEntries(Object.keys(VARIABLES).map(k=>[k,Number(d.get(k))])),sites:d.getAll('site'),prediction:{meanNm:d.get('pMean'),nonuniformityPct:d.get('pUni'),reason:d.get('reason')}},now()));});}
  content.querySelector('#lab-best')?.addEventListener('submit',e=>{e.preventDefault();const v=Number(new FormData(e.currentTarget).get('best'));run(l=>selectBest(l,v));});
  content.querySelector('#lab-confirm')?.addEventListener('click',()=>run(l=>runConfirmation(l,now())));
  const end=content.querySelector('#lab-end');end?.addEventListener('click',()=>{if(!end.dataset.armed){end.dataset.armed='1';end.textContent='한 번 더 누르면 종료 (이후 실험 불가)';return;}run(l=>endSession(l,now()));});
  content.querySelector('#lab-csv')?.addEventListener('click',()=>{const s=getLab().session;const blob=new Blob(['﻿'+labCsv(s)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`nmos-fab-lab-${s.id}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);});
}
