import {ADVISOR as A} from '../constants.js';
import {ROLE_LABELS,buildEvidencePacket,ruleBasedMeeting,callClaude} from '../systems/advisor.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='nmos-fab-anthropic-key',MODEL='nmos-fab-anthropic-model';
// 키는 이 브라우저의 localStorage에만 저장합니다. 코드·GitHub·게임 저장 데이터에는 들어가지 않습니다.
const read=k=>{try{return localStorage.getItem(k)??'';}catch{return '';}};
const write=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k);return true;}catch{return false;}};
export const hasKey=()=>!!read(KEY);
const CONF={low:'근거 부족',medium:'가능성 있음',high:'근거 있음'};
function meetingCard(m){
  return `<div class="meeting"><p class="muted">${m.source==='ai'?`생성형 AI 회의 · ${esc(m.model)}`:'규칙 기반 회의 (AI 미사용)'}${m.fallbackReason?` · AI 실패로 대체: ${esc(m.fallbackReason)}`:''}${m.question?` · 질문: ${esc(m.question)}`:''}</p>
  <div class="opinions">${m.opinions.map(o=>`<div class="opinion conf-${o.confidence}"><strong>${esc(ROLE_LABELS[o.role])}</strong><span class="conf">${CONF[o.confidence]}</span><p>${esc(o.hypothesis)}</p><p class="next">다음 확인: ${esc(o.next)}</p><p class="basis">근거: ${o.basis.length?o.basis.map(esc).join(', '):'없음'}${o.inventedBasis?.length?` · <span class="warn">존재하지 않는 증거 인용 제거: ${o.inventedBasis.map(esc).join(', ')}</span>`:''}</p></div>`).join('')}</div>
  ${m.summary?`<p class="summary">${esc(m.summary)}</p>`:''}</div>`;
}
export function advisorSection(state){
  const inc=state.incident,meetings=inc.meetings??[],key=hasKey();
  return `<section class="advisor"><h4>긴급 부서 회의</h4><p class="muted">PE·EE·계측 엔지니어가 지금까지 확인한 증거만 보고 의견을 내요. 숨은 원인은 모르고, 판정은 내가 해요. 회의 1회 ${A.meetingMinutes}분.</p>
  <form id="meeting-form"><label>질문 (선택)<input name="question" maxlength="${A.maxTextLength}" placeholder="예: 기준 시료가 정상이면 다음엔 뭘 봐야 해?"></label><div class="tool-actions"><button class="primary" name="mode" value="ai" ${key?'':'disabled'}>AI 회의 소집</button><button class="secondary" name="mode" value="rules">규칙 기반 회의</button></div><p id="meeting-status" class="muted" role="status">${key?'':'AI 회의를 쓰려면 아래 설정에서 API 키를 입력하세요.'}</p></form>
  ${meetings.length?meetings.slice().reverse().map(meetingCard).join(''):''}
  <details class="model-note"><summary>AI 설정 (내 API 키)</summary><p>Claude API 키를 넣으면 이 브라우저에서 직접 Anthropic API를 불러요. 키는 이 브라우저에만 저장되고 GitHub·게임 저장 데이터에는 들어가지 않아요. 공용 PC에서는 쓰지 말고, Anthropic 콘솔에서 월 사용 한도를 꼭 걸어두세요.</p>
  <form id="advisor-settings"><label>API 키<input name="key" type="password" autocomplete="off" placeholder="${key?'저장됨 · 바꾸려면 새로 입력':'sk-ant-...'}"></label><label>모델<input name="model" value="${esc(read(MODEL)||A.defaultModel)}"></label><div class="tool-actions"><button class="secondary">저장</button><button type="button" id="advisor-clear" class="secondary">키 삭제</button></div></form></details></section>`;
}
export function meetingSummary(state){
  const ms=state.incident?.meetings??[];if(!ms.length)return '';
  return `<p>긴급 회의 ${ms.length}회 (AI ${ms.filter(m=>m.source==='ai').length}회)</p>${meetingCard(ms.at(-1))}`;
}
export function bindAdvisor(content,{global,getState,rerender}){
  const form=content.querySelector('#meeting-form');if(!form)return;
  const status=content.querySelector('#meeting-status');
  form.addEventListener('submit',async e=>{
    e.preventDefault();const mode=e.submitter?.value??'rules',question=new FormData(form).get('question')??'',packet=buildEvidencePacket(getState(),question);
    for(const b of form.querySelectorAll('button'))b.disabled=true;
    if(mode==='rules'){global({type:'incident-meeting',source:'rules',question,...ruleBasedMeeting(packet)});return;}
    status.textContent='AI 엔지니어들이 증거를 검토하고 있어요…';
    try{const model=read(MODEL)||A.defaultModel,m=await callClaude(packet,{apiKey:read(KEY),model});global({type:'incident-meeting',source:'ai',model,question,...m});}
    catch(err){global({type:'incident-meeting',source:'rules',question,fallbackReason:err.message,...ruleBasedMeeting(packet)});}
  });
  content.querySelector('#advisor-settings')?.addEventListener('submit',e=>{e.preventDefault();const d=new FormData(e.currentTarget),k=String(d.get('key')||'').trim(),m=String(d.get('model')||'').trim();
    if(k)write(KEY,k);write(MODEL,m&&m!==A.defaultModel?m:'');rerender();});
  content.querySelector('#advisor-clear')?.addEventListener('click',()=>{write(KEY,'');rerender();});
}
