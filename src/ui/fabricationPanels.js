import {knownThickness} from './metrologyPanel.js';
import {DEPOSITION as D} from '../constants.js';
import {depositFilm} from '../systems/fabrication.js';
const n=v=>Number(v).toFixed(1),pct=v=>(v*100).toFixed(2);
export const materialName={poly:'Poly-Si',ild:'층간 SiO₂',metal:'Al'};
export function fabricationSummary(r){
  if(r.kind==='electrical')return `${r.grade} 등급 / ${r.score}점 · Vt ${r.vtV.toFixed(3)} V<br>Ion ${r.ionA===null?'산출불가':(r.ionA*1000).toFixed(3)+' mA'}`;
  if(r.kind==='strip')return 'PR 제거 완료 · 기존 재료/결함 보존';
  if(r.kind==='deposition')return `${materialName[r.material]} 평균 ${n(r.meanNm)} nm<br>증착률 ${n(r.rateNmPerMinute)} nm/분 · 비균일도 ${pct(r.nonuniformity)}%<br>최소 ${n(r.minNm)} / 최대 ${n(r.maxNm)} nm${r.contactReady===false?'<br>접촉 창 결함 누적':''}`;
  if(r.kind==='pattern-etch')return `${r.status} · 최대 잔류 ${n(r.maxResidualNm)} nm<br>보호부 최소 ${n(r.protectedMinNm)} nm · 하부 손실 ${n(r.maxUnderlyingLossNm)} nm<br>정렬 ${n(r.overlayUm)} µm · 박리 ${pct(r.defectFraction)}%`;
  if(r.kind==='implant')return `P: Rp ${n(r.rpNm)} / ΔRp ${n(r.straggleNm)} nm<br>유효 도즈 ${r.effectiveDoseCm2.toExponential(2)} cm⁻² · 산화막 투과 ${(r.transmission*100).toFixed(1)}%`;
  if(r.kind==='anneal')return `접합 깊이 ${n(r.junctionNm)} nm · 면저항 ${n(r.sheetOhm)} Ω/□<br>활성화 ${(r.activation*100).toFixed(1)}% · 피크 ${r.peakCm3.toExponential(2)} cm⁻³`;
  return null;
}
export function depositionDetails(r,title='5지점 두께 분포'){
  return `<section class="deposition-details"><h3>${title}</h3><div class="metric-row"><div><span>평균 두께</span><strong>${n(r.meanNm)}<small> nm</small></strong></div><div><span>증착률</span><strong>${n(r.rateNmPerMinute)}<small> nm/분</small></strong></div><div><span>비균일도</span><strong>${pct(r.nonuniformity)}<small> %</small></strong></div></div><div class="wafer-map" aria-label="웨이퍼 중앙 북 동 남 서 두께 분포">${r.sites.map((s,i)=>`<div class="wafer-site site-${i}" style="--site-light:${75-((s.thicknessNm-r.meanNm)/(r.meanNm||1))*100}%"><span>${s.name}</span><strong>${n(s.thicknessNm)}</strong><small>nm</small></div>`).join('')}</div><div class="thickness-bars">${r.sites.map(s=>`<div><span>${s.name}</span><i style="width:${s.thicknessNm/(r.maxNm||1)*100}%"></i><strong>${n(s.thicknessNm)} nm</strong></div>`).join('')}</div><p>최소 ${n(r.minNm)} nm · 최대 ${n(r.maxNm)} nm</p><p class="muted">비균일도 = (최대−최소)/(2×평균) × 100<br>작을수록 고릅니다. 5지점은 동일 면적 가중의 교육용 샘플이며 실제 전면 계측을 대신하지 않습니다.</p><div class="target-box"><p>평균 목표 ${r.targetNm} nm ±${D.thicknessTolerance*100}% · 비균일도 ≤${r.uniformityLimit*100}%</p><p>이번 추가량 ${n(r.addedMeanNm)} nm = ${n(r.rateNmPerMinute)} nm/분 × ${n(r.minutes)}분</p></div></section>`;
}
export function fabricationDetails(r){
  if(r.kind==='deposition')return depositionDetails(r,'기록된 5지점 두께');
  if(r.kind==='anneal'){
    const maxDepth=r.profile.at(-1).depthNm,top=Math.max(20,Math.ceil(Math.log10(r.peakCm3))),bottom=15;
    const points=r.profile.map(p=>`${30+p.depthNm/maxDepth*500},${165-Math.max(0,Math.log10(Math.max(1,p.concentrationCm3))-bottom)/(top-bottom)*130}`).join(' ');
    return `<section class="implant-profile"><h3>활성 도펀트 가우시안 분포</h3><svg viewBox="0 0 560 200" role="img" aria-label="깊이 nm에 따른 활성 인 농도 로그 그래프"><path d="M30 20V165H535" fill="none" stroke="#829da6"/><polyline points="${points}" fill="none" stroke="#117d78" stroke-width="3"/><text x="30" y="190">0 nm</text><text x="450" y="190">${n(maxDepth)} nm</text><text x="35" y="24">log₁₀ N [cm⁻³] · ${bottom}~${top}</text></svg><p class="muted">가우시안·확산·고정 이동도 근사. 채널링, 농도 의존 이동도, 활성화 포화와 실제 SIMS/면저항 계측 오차는 검증 필요입니다.</p></section>`;
  }return '';
}
export function depositionExplanation(material){
  if(material==='metal')return '<p>증착률 = 100 × 파워/200 nm/분. 기판 회전은 위치별 편차를 줄입니다. 시간을 늘리면 모든 지점 두께가 함께 증가하지만 상대 비균일도는 줄지 않습니다.</p>';
  return '<p>증착률은 기준 온도를 중심으로 Arrhenius 온도 의존성을 사용합니다. 온도 분포 폭은 위치별 성장 편차를 만듭니다. 시간만 바꾸면 평균·최소·최대 두께가 함께 변하고 상대 비균일도는 유지됩니다.</p>';
}
export function bindDeposition(content,state,op){
  const form=content.querySelector('#process-form'),preview=content.querySelector('#deposition-preview');if(!form||!preview)return;
  const update=()=>{try{const data=new FormData(form),input=Object.fromEntries(op.parameters.map(p=>[p.key,p.options?data.get(p.key):Number(data.get(p.key))]));const r=depositFilm(op.material,input,state.films[op.material]?.values,op.targetThicknessNm);preview.innerHTML=depositionDetails(r,'입력 조건의 예상 분포');}catch{preview.textContent='입력 범위를 확인하면 예상 두께를 표시합니다.';}};
  form.addEventListener('input',update);form.addEventListener('change',update);update();
}
export function fabricationSection(state,mini=false){
  const mean=values=>values?.reduce((a,b)=>a+b,0)/values?.length||0;
  const geometry=state.geometry??{},films=state.films??{},pattern=state.patterns??{};
  const polyOpen=pattern.gate?mean(geometry.poly?.openValues):films.poly?.meanNm??0;
  const polyGate=pattern.gate?mean(geometry.poly?.protectedValues):films.poly?.meanNm??0;
  const ildOpen=pattern.contact?mean(geometry.ild?.openValues):films.ild?.meanNm??0;
  const ildProtected=pattern.contact?mean(geometry.ild?.protectedValues):films.ild?.meanNm??0;
  const metalOpen=pattern.metal?mean(geometry.metal?.openValues):films.metal?.meanNm??0;
  const metalWire=pattern.metal?mean(geometry.metal?.protectedValues):films.metal?.meanNm??0;
  const cols=[['Field',state.fieldOxideNm,polyOpen,ildProtected,metalOpen],['S/D',state.screenOxideNm??state.activeOxideNm,polyOpen,ildOpen,metalWire],['Gate',state.gateOxideNm??state.activeOxideNm,polyGate,ildProtected,metalWire],['S/D',state.screenOxideNm??state.activeOxideNm,polyOpen,ildOpen,metalWire],['Field',state.fieldOxideNm,polyOpen,ildProtected,metalOpen]];
  const layer=(type,value,max,scale)=>value>0?`<div class="film-layer ${type}-layer" title="${type}" style="height:${Math.max(3,Math.min(max,value/scale))}px"></div>`:'';
  const group=state.photo?.group;
  const html=cols.map(([name,oxide,poly,ild,metal],i)=>{
    const opened=(group==='gate'?i!==2:group==='contact'?i===1||i===3:group==='metal'?i===0||i===4:i===2);
    const pr=opened?(state.etch?.openingPrNm??state.photo?.developed?.openingPrNm??state.prNm):state.prNm;
    return `<div class="section-col"><div class="layer-stack">${layer('pr',pr,mini?10:28,mini?100:45)}${layer('metal',metal,mini?10:25,mini?40:15)}${layer('ild',ild,mini?15:45,mini?30:10)}${layer('poly',poly,mini?10:30,mini?20:7)}${layer('oxide',oxide,mini?20:45,mini?20:8)}</div><div class="si-layer ${state.anneal&&(i===1||i===3)?'doped':''}">${mini?name:state.anneal&&(i===1||i===3)?'n+ '+name:name+' / Si'}</div></div>`;
  }).join('');
  const known=knownThickness(state),m=v=>v===undefined?'미측정':n(v)+' nm';
  return `<div class="pattern-section extended-section">${html}</div><p class="layer-legend">Gate SiO₂ <strong>${m(known.gate)}</strong></p><p class="muted">측정값 · Poly ${m(known.poly)} · ILD ${m(known.ild)} · Al ${m(known.metal)}</p>${mini?'':`<p>Field SiO₂(초기 측정): ${m(known.field)}</p><p>보라 PR · 회색 Al · 연청색 ILD · 금색 Poly · 청록 SiO₂ · 남색 Si / 초록 n+</p><p class="muted">층별 두께를 확대·압축한 대표 단면입니다. Contact·배선 연결은 개념 표현이며 실제 마스크 레이아웃/회로 연결을 재현하지 않습니다. 정렬·박리·잔사는 Runsheet의 마스크별 수치로 보존합니다.</p>`}`;
}
