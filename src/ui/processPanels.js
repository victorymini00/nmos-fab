import {OXIDATION as C,PHOTO as P,ETCH as E} from '../constants.js';
import {currentTask,latestRecord,targetThickness,operations,recommendedEtchMinutes,recommendedPatternEtchMinutes,canRestartPhoto} from '../systems/runsheet.js';
import {fabricationSummary,fabricationDetails,depositionExplanation,fabricationSection} from './fabricationPanels.js';
import {isThicknessOperation,describeMeasurement} from '../systems/metrology.js';
import {metrologyPanel,toolStatus,knownThickness,waferMap} from './metrologyPanel.js';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v).toFixed(1);
const labels={wet:'습식',dry:'건식',apply:'처리',skip:'생략',on:'켜짐',off:'꺼짐'};
const display=v=>labels[v]??v;
const stamp=v=>new Date(v).toLocaleString('ko-KR');
const modelNames={'rca-check':'입고·세정',hmds:'HMDS',spin:'스핀코팅',exposure:'정렬·노광',develop:'현상',boe:'BOE 식각','deal-grove':'산화','gate-oxide':'게이트 산화',deposit:'증착','pattern-etch':'패턴 식각',implant:'S/D 인 주입',anneal:'활성화 어닐링',strip:'PR 제거'};
export function crossSection(state,flow,mini=false){
  if(state.gateOxideNm!==null&&state.gateOxideNm!==undefined)return fabricationSection(state,mini);
  const pr=state.prNm||0,dev=state.photo?.developed,etched=state.etch;
  const openingPr=etched?.openingPrNm??dev?.openingPrNm??pr;
  const active=state.activeOxideNm??state.oxideNm,field=state.fieldOxideNm??state.oxideNm;
  const height=(x,max,scale)=>Math.max(x>0?3:0,Math.min(max,x/scale));
  const cols=[{name:'Field',oxide:field,pr},{name:'Active',oxide:active,pr:openingPr},{name:'Field',oxide:field,pr}];
  return `<div class="pattern-section">${cols.map((c,i)=>`<div class="section-col"><div class="layer-stack"><div class="pr-layer" style="height:${height(c.pr,mini?25:65,mini?70:30)}px"></div><div class="oxide-layer" style="height:${height(c.oxide,mini?35:80,mini?12:5)}px"></div></div><div class="si-layer">${mini?'Si':c.name+' / Si'}</div></div>`).join('')}</div><p class="layer-legend">Field SiO₂ <strong>${knownThickness(state).field!==undefined?'측정 '+n(knownThickness(state).field)+' nm':'미측정'}</strong></p><p class="muted">두께는 측정값만 표시 · PR ${n(pr)} nm</p>${mini?'':`<div class="target-box">${dev?`<p>열린 영역 PR 잔사: ${n(openingPr)} nm<br>접착 불량 가정 면적: ${(dev.defectFraction*100).toFixed(1)}%<br>정렬 오차: ${n(state.photo.alignment.overlayUm)} µm</p>`:''}${etched?`<p>박리 결함 영역 산화막: ${n(etched.defectOxideNm)} nm<br>언더컷 ${n(etched.undercutNm)} nm / ${esc(etched.status)}</p>`:''}<p>보라: 양성 PR · 청록: SiO₂ · 남색: Si</p></div><p class="muted">개념 단면 · 수직/수평 비례 아님. 색상은 재료 구분용이며 실제 간섭색은 검증 필요입니다. 정렬 오차는 수치로, 박리는 별도 결함 면적으로 표현합니다.</p>`}`;
}
function card(stage){return `<section class="process-card"><h3>이 공정은 왜 하나?</h3>${stage.card.map(t=>`<p>${esc(t)}</p>`).join('')}</section>`;}
function signForm(failed=false){return `<form id="sign-form">${failed?'<label class="check"><input type="checkbox" name="acknowledge" required>검사에서 확인한 결함을 인지하고 다음 공정에 반영합니다.</label>':''}<label>확인 서명<input name="signature" required maxlength="32" placeholder="공정 엔지니어 이름"></label><button class="primary">${failed?'결함 인지 후 서명 · 계속 진행':'확인 서명 · 공정 완료'}</button></form>`;}
export function resultSummary(result){
  const summary=fabricationSummary(result);if(summary)return summary;
  if(result.thicknessNm!==undefined)return `산화막 ${n(result.thicknessNm)} nm`;
  if(result.status)return `${esc(result.status)} · Active 잔류 ${n(result.activeOxideNm)} nm<br>Field ${n(result.fieldOxideNm)} nm · 결함부 ${n(result.defectOxideNm)} nm<br>박리 ${(result.defectFraction*100).toFixed(1)}% · 정렬 ${n(result.overlayUm)} µm<br>언더컷 ${n(result.undercutNm)} nm · 누적 ${n(result.totalMinutes)}분`;
  if(result.openingPrNm!==undefined)return `PR 잔사 ${n(result.openingPrNm)} nm · 보호 PR ${n(result.protectedPrNm)} nm<br>박리 면적 ${(result.defectFraction*100).toFixed(1)}% · 정렬 ${n(result.overlayUm)} µm`;
  if(result.prNm!==undefined)return `PR ${n(result.prNm)} nm · 소프트베이크 ${result.softBakeC}°C/${result.softBakeSeconds}초`;
  if(result.overlayUm!==undefined)return `정렬 ${n(result.overlayUm)} µm · ${result.alignmentPass?'허용 범위':'정렬 이탈'} · 노광 ${result.dose} mJ/cm²`;
  if(result.hmds!==undefined)return `HMDS ${result.hmds?'처리':'생략'} · 접착 지수 ${result.adhesion}`;
  return result.penaltyPoints?`재작업 감점 예약 ${result.penaltyPoints}점`:'입고·RCA 세정 완료';
}
function parameters(op,state){return op.parameters.filter(p=>!['offsetXUm','offsetYUm','rotationDeg'].includes(p.key)).map(p=>{
  const value=op.modelId==='boe'&&p.key==='minutes'?Math.max(.01,recommendedEtchMinutes(state)-(state.etch?.totalMinutes??0)).toFixed(2):p.target;
  const actual=op.modelId==='pattern-etch'&&p.key==='minutes'?recommendedPatternEtchMinutes(state,op).toFixed(3):value;
  return `<label>${esc(p.label)} ${esc(p.unit)}${p.options?`<select name="${esc(p.key)}">${p.options.map(v=>`<option value="${esc(v)}" ${v===actual?'selected':''}>${esc(display(v))}</option>`).join('')}</select>`:`<input name="${esc(p.key)}" type="number" step="any" min="${p.min}" max="${p.max}" value="${actual}" required>`}</label>`;
}).join('');}
function alignmentGame(){const a=P.initialAlignment;return `<section class="alignment-game"><h3>마스크 정렬</h3><p class="muted">기준 십자(청록)와 마스크 십자(자주)를 맞추세요. 보드를 클릭하고 방향키로 이동, Q/E로 회전합니다.</p><div id="alignment-board" tabindex="0" role="group" aria-label="마스크 정렬 보드"><div class="wafer-mark">＋</div><div id="mask-overlay"><span>＋</span><div class="mask-window"></div></div></div><div class="form-grid">${[['offsetXUm','X 이동',a.offsetXUm,-P.maxOffsetUm,P.maxOffsetUm,P.alignmentStepUm],['offsetYUm','Y 이동',a.offsetYUm,-P.maxOffsetUm,P.maxOffsetUm,P.alignmentStepUm],['rotationDeg','회전',a.rotationDeg,-P.maxRotationDeg,P.maxRotationDeg,P.rotationStepDeg]].map(([key,label,value,min,max,step])=>`<label>${label}<input type="range" name="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`).join('')}</div><p id="alignment-status" aria-live="polite"></p></section>`;}
export function equipmentPanel(e,state,flow){
  const task=currentTask(state,flow);
  if(!task)return '<div class="result success"><h3>NMOS 제작·테스트 완료</h3><p>Test 장비에서 전기적 결과를 다시 확인하거나 Runsheet에서 전체 보고서를 저장하세요.</p></div>';
  const {stage,operation:op}=task,r=latestRecord(state,flow);
  let html=`<p class="muted">${esc(e.id.toUpperCase())} · 스테이지 ${stage.number} · ${esc(modelNames[op.modelId])}</p>`;
  if(e.id===op.equipmentId){
    html+=card(stage);
    if(op.modelId==='rca-check')html+=r?'<div class="result success">입고·RCA 세정 완료</div>'+signForm():'<button id="clean" class="primary">웨이퍼 입고 확인 · RCA 세정 완료</button>';
    else{
      const target=['deal-grove','gate-oxide'].includes(op.modelId)?`<p>두께 ${n(targetThickness(op))} nm ±${op.thicknessToleranceFraction*100}%</p>`:op.modelId==='boe'?`<p>현재 Field ${n(state.fieldOxideNm)} nm · 6:1 BOE ${E.oxideRateNmPerMinute} nm/분</p><p>초기 권장 시간 ${recommendedEtchMinutes(state).toFixed(2)}분(10% 여유)${state.etch?` · 이미 ${state.etch.totalMinutes.toFixed(2)}분 처리됨. 추가 시간만 입력하세요.`:''}</p>`:op.modelId==='pattern-etch'?`<p>현재 마스크 ${esc(op.photoGroup)} · 최대 막 두께 ${n(state.photo?.referenceFilmMaxNm)} nm<br>5지점 중 가장 두꺼운 지점을 기준으로 계산한 추가 시간: ${recommendedPatternEtchMinutes(state,op).toFixed(3)}분</p>`:op.modelId==='deposit'?`<p>평균 두께 목표 ${op.targetThicknessNm} nm · 위치별 분포도 함께 확인하세요.</p>`:'';
      html+=`<div class="target-box"><strong>Runsheet 목표</strong><p>${op.parameters.filter(p=>!['offsetXUm','offsetYUm','rotationDeg'].includes(p.key)).map(p=>`${esc(p.label)} ${esc(display(p.target))} ${esc(p.unit)}`).join(' · ')}</p>${target}</div>`;
      if(r&&isThicknessOperation(op))html+=`<div class="result"><strong>공정 완료 · 장비 로그 기록</strong><p>${r.measurement?`최근 측정: 평균 ${n(r.measurement.meanNm)} nm (${r.measurement.observed.length}점) · ${r.measurement.pass?'합격':'불합격'}`:'실제 두께는 장비가 알려주지 않아요. 계측 장비로 이동해 측정하세요.'}</p>${r.result.warning?`<p class="muted">${esc(r.result.warning)}</p>`:''}</div>${r.measurement?waferMap(r.measurement):''}`;
      else if(r)html+=`<div class="result"><strong>${resultSummary(r.result)}</strong><p>${r.measurement?'검사 기록 있음 · 추가 처리 또는 확인 서명':'검사 대기: 계측 장비로 이동하세요.'}</p>${r.result.warning?`<p class="muted">${esc(r.result.warning)}</p>`:''}</div>${fabricationDetails(r.result)}`;
      if(!r||r.measurement&&['deal-grove','gate-oxide','boe','pattern-etch','deposit'].includes(op.modelId)){
        html+=`<form id="process-form">${op.modelId==='exposure'?alignmentGame():''}<div class="form-grid">${parameters(op,state)}</div>${op.modelId==='hmds'?'<p class="muted">생략을 선택해도 진행할 수 있으나 현상·BOE 결과에 접착 결함이 남습니다.</p>':''}${op.modelId==='spin'?`<p class="muted">h = ${P.referencePrNm} × (${P.referenceRpm}/rpm)^0.5 nm · 소프트베이크 ${P.softBakeC}°C/${P.softBakeSeconds}초 자동 처리</p>`:''}${r?'<p class="muted">추가 처리는 누적됩니다. 과식각·과산화된 막은 되돌릴 수 없습니다.</p>':''}<button class="primary">${op.modelId==='exposure'?'현재 정렬로 노광 실행':r?'추가 공정 실행':`${esc(modelNames[op.modelId])} 실행`}</button></form>`;
        if(op.modelId==='deposit')html+=`<div class="process-card">${depositionExplanation(op.material)}<p class="muted">기준 증착률·편차 계수는 교육용 보정이며 실제 장비 교정은 검증 필요입니다.</p></div><div id="deposition-preview"></div>`;
      }
      if(['deposit','implant','anneal','pattern-etch','gate-oxide','strip'].includes(op.modelId))html+='<details class="model-note"><summary>교육 모델 · 출처와 검증 필요 항목</summary><p>Poly 기준 10 nm/분@620°C는 대학 LPCVD 자료를 참고한 교육용 보정입니다. Al 100 nm/분@200 W, 공간 편차, 활성화 계수, 선택비·판정 경계는 실제 장비 교정 전 검증 필요입니다. 5지점 분포는 결정론적이며 계측 노이즈는 생략합니다.</p><p>주입은 P 범위·산포 표와 가우시안, 어닐링은 확산·활성화 근사입니다. 게이트 산화는 초기 건식 성장 보정이 없는 Deal–Grove로 검증 필요입니다.</p><a href="https://fabweb.ece.illinois.edu/gt/gt/gt15.aspx" target="_blank" rel="noopener">P 주입 표</a> · <a href="https://fabweb.ece.illinois.edu/gt/gt/gt10.aspx" target="_blank" rel="noopener">확산 계수</a> · <a href="https://uhnf.egr.uh.edu/pythography/sputtering-guide/sputtering-uniformity/" target="_blank" rel="noopener">스퍼터 균일도 계측</a></details>';
      else html+='<details class="model-note"><summary>교육 모델 · 검증 필요 항목</summary><p>PR 1.5 µm@3000 rpm, 노광 100 mJ/cm², 현상 60초는 특정 제품 규격이 아닌 교육용 보정값입니다. 접착 손실 면적과 선택비·판정 경계는 검증 필요입니다.</p><p>BOE 제거량=80 nm/분×시간. PR 잔사가 있으면 PR 소모 뒤 산화막 식각을 시작합니다. 등방성 언더컷은 식각 거리로 근사합니다. 선택비 SiO₂:PR=20:1은 교육용 가정입니다.</p><a href="https://sums.gatech.edu/articles/ProEtch" target="_blank" rel="noopener">BOE 출처</a> · <a href="https://www.microchemicals.com/dokumente/application_notes/spin_coating_photoresist.pdf" target="_blank" rel="noopener">스핀코팅 출처</a></details>';
    }
  }else if(e.id===op.measurementEquipmentId&&isThicknessOperation(op)){
    html+=metrologyPanel(state,op,r,signForm);
  }else if(e.id===op.measurementEquipmentId){
    html+=`<section class="process-card"><h3>${op.measurementType==='pattern'?'현상 패턴 검사':op.measurementType==='etch'?'식각 결과 검사':op.measurementType==='deposition'?'막 두께·균일도 5지점 측정':op.measurementType==='device'?'접합 깊이·면저항 검사':'산화막 두께 측정'}</h3><p>모델 계산 결과를 계측 기록으로 저장합니다. 실제 장비 노이즈는 생략한 교육용 측정입니다.</p></section>`;
    if(!r)html+='<p class="result">지정된 장비에서 공정을 먼저 실행하세요.</p>';
    else if(!r.measurement)html+='<button id="measure" class="primary">웨이퍼 측정 · 검사</button>';
    else{const m=r.measurement;html+=`<div class="result ${m.pass?'success':'failure'}"><strong>${m.pass?'합격':'결함 / 조건 이탈'}</strong><p>${op.measurementType?resultSummary(m):`${n(m.thicknessNm)} nm · 목표 대비 ${(m.deviation*100).toFixed(1)}%`}</p></div>${fabricationDetails(m)}`;
      html+=m.pass||op.acceptDefects?signForm(!m.pass):'<p>목표 미달입니다. 공정 장비에서 재작업하거나 새 Lot을 시작하세요.</p>';
    }
  }else html+='<p class="result">현재 공정에 지정된 장비로 이동하세요.</p>'+(e.id==='metrology'?toolStatus(state):'');
  if(e.id==='coater'&&canRestartPhoto(state,flow))html+=`<details class="new-lot"><summary>현재 마스크 PR 제거 후 재작업</summary><p>대상 막을 유지하고 현재 마스크의 HMDS부터 다시 시작합니다. 이력을 남기고 재작업 ${P.reworkPenalty}점을 기록합니다.</p><button id="restart-photo" class="secondary">포토 재작업 시작</button></details>`;
  return html+'<p id="action-error" class="error" role="alert"></p>';
}
export function runsheetPanel(state,flow,layout){
  const tasks=operations(flow),rows=[];
  for(const {stage,operation:op} of tasks){
    const history=state.records.filter(r=>r.operationId===op.id);
    for(const r of history.length?history:[null]){
      const target=op.modelId==='rca-check'?'웨이퍼 1장 · RCA 세정':op.parameters.map(p=>`${esc(p.label)} ${esc(display(p.target))}${esc(p.unit)}`).join('<br>')+(['deal-grove','gate-oxide'].includes(op.modelId)?`<br>산화막 ${n(targetThickness(op))} nm ±${op.thicknessToleranceFraction*100}%`:op.targetThicknessNm?`<br>평균 ${op.targetThicknessNm} nm`:'');
      const actual=r?Object.entries(r.input).map(([k,v])=>`${esc(op.parameters.find(p=>p.key===k)?.label??k)}: ${esc(display(v))}`).join('<br>')||'입고·세정 완료':'—';
      rows.push(`<tr class="${r?.superseded?'superseded':''}"><td>${stage.number}. ${esc(stage.title)}<br>${esc(modelNames[op.modelId])}${r?.rework?'<br>재작업':''}${r?.superseded?'<br>이전 이력':''}</td><td>${esc(layout.equipment.find(e=>e.id===op.equipmentId)?.name??op.equipmentId)}</td><td>${target}</td><td>${actual}</td><td>${r?(isThicknessOperation(op)&&currentTask(state,flow)?'<span class="muted">실제 값은 Lot 완료 후 공개</span>':resultSummary(r.result)):'—'}</td><td>${r?.measurement?`${r.measurement.pass?'합격':'결함 / 조건 이탈'}<br>${r.measurement.metrology?esc(describeMeasurement(r.measurement)).replaceAll('\n','<br>')+(r.measurements?.length>1?`<br><small>측정 ${r.measurements.length}회</small>`:''):op.measurementType?resultSummary(r.measurement):n(r.measurement.thicknessNm)+' nm'}`:'—'}</td><td>${r?.signature?`${esc(r.signature.name)}${r.signature.acknowledgedDefects?'<br>결함 인지':''}<br><small>${esc(stamp(r.signature.signedAt))}</small>`:r?.autoCompleted?'자동 기록 완료':r?'확인 대기':'공정 대기'}</td></tr>`);
    }
  }
  return `<p class="muted">${esc(state.lotId)} · 자동 기록 · 재작업 ${state.reworkCount}회 / 누적 감점 예약 ${state.penaltyPoints}점</p><div class="table-scroll"><table><thead><tr>${['단계 / 작업','장비','목표 조건','실제 입력','계산 결과','계측 기록','확인 서명'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div><details><summary>재작업 이력</summary>${state.records.filter(r=>r.operationId==='photo-rework').map(r=>`<p>PR 제거 · ${esc(stamp(r.executedAt))} · ${r.result.penaltyPoints}점</p>`).join('')||'없음'}</details><details class="new-lot"><summary>새 Lot 시작</summary><p>현재 Lot 기록을 초기화하고 세정부터 다시 시작합니다.</p><button id="new-lot" class="secondary">현재 기록 초기화 · 새 Lot</button></details>`;
}
