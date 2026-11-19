import {ADVISOR as A} from '../constants.js';
import {ROLE_LABELS,buildEvidencePacket,ruleBasedMeeting,callClaude,callGemini,listGeminiModels} from '../systems/advisor.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// 키는 이 브라우저의 localStorage에만 저장합니다. 코드·GitHub·게임 저장 데이터에는 들어가지 않습니다.
const S={provider:'nmos-fab-ai-provider',gemini:'nmos-fab-gemini-key',geminiModel:'nmos-fab-gemini-model',claude:'nmos-fab-anthropic-key',claudeModel:'nmos-fab-anthropic-model'};
const read=k=>{try{return localStorage.getItem(k)??'';}catch{return '';}};
const write=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k);return true;}catch{return false;}};
const provider=()=>read(S.provider)||A.defaultProvider;
const modelOf=p=>p==='gemini'?(read(S.geminiModel)||A.geminiModel):(read(S.claudeModel)||A.defaultModel);
export const hasKey=()=>!!read(S[provider()]);
const LABEL={gemini:'Gemini (무료 등급)',claude:'Claude (유료)'};
const CONF={low:'근거 부족',medium:'가능성 있음',high:'근거 있음'};
function meetingCard(m){
  return `<div class="meeting"><p class="muted">${m.source==='ai'?`생성형 AI 회의 · ${esc(m.model)}`:'규칙 기반 회의 (AI 미사용)'}${m.fallbackReason?` · AI 실패로 대체: ${esc(m.fallbackReason)}`:''}${m.question?` · 질문: ${esc(m.question)}`:''}</p>
  <div class="opinions">${m.opinions.map(o=>`<div class="opinion conf-${o.confidence}"><strong>${esc(ROLE_LABELS[o.role])}</strong><span class="conf">${CONF[o.confidence]}</span><p>${esc(o.hypothesis)}</p><p class="next">다음 확인: ${esc(o.next)}</p><p class="basis">근거: ${o.basis.length?o.basis.map(esc).join(', '):'없음'}${o.inventedBasis?.length?` · <span class="warn">존재하지 않는 증거 인용 제거: ${o.inventedBasis.map(esc).join(', ')}</span>`:''}</p></div>`).join('')}</div>
  ${m.summary?`<p class="summary">${esc(m.summary)}</p>`:''}</div>`;
}
export function advisorSection(state){
  const inc=state.incident,meetings=inc.meetings??[],p=provider(),key=hasKey();
  if(inc.mode==='no-ai')return `<section class="advisor"><h4>긴급 부서 회의</h4><p class="muted">이번 퀘스트는 실험 조건 "AI 회의 없이 혼자 해결"이라 회의를 쓰지 않아요.</p></section>`;
  return `<section class="advisor"><h4>긴급 부서 회의</h4><p class="muted">PE·EE·계측 엔지니어가 지금까지 확인한 증거만 보고 의견을 내요. 숨은 원인은 모르고, 판정은 내가 해요. 회의 1회 ${A.meetingMinutes}분.</p>
  <form id="meeting-form"><label>질문 (선택)<input name="question" maxlength="${A.maxTextLength}" placeholder="예: 기준 시료가 정상이면 다음엔 뭘 봐야 해?"></label><div class="tool-actions"><button class="primary" name="mode" value="ai" ${key?'':'disabled'}>AI 회의 소집 · ${LABEL[p]}</button><button class="secondary" name="mode" value="rules">규칙 기반 회의</button></div><p id="meeting-status" class="muted" role="status">${key?`모델: ${esc(modelOf(p))}`:'AI 회의를 쓰려면 아래 설정에서 API 키를 입력하세요.'}</p></form>
  ${meetings.slice().reverse().map(meetingCard).join('')}
  <details class="model-note" ${key?'':'open'}><summary>AI 설정 (내 API 키)</summary>
  <p><strong>Gemini 무료 등급</strong>: Google AI Studio(aistudio.google.com)에서 API 키를 만드세요. 결제 계정을 연결하지 않으면 과금되지 않아요. 무료 등급 입력은 Google 제품 개선에 쓰일 수 있으니 개인정보는 넣지 마세요(게임은 가상 측정값만 보내요).</p>
  <p>키는 이 브라우저에만 저장되고 GitHub·게임 저장 데이터에는 들어가지 않아요. 공용 PC에서는 쓰지 마세요.</p>
  <form id="advisor-settings"><label>AI 제공사<select name="provider">${['gemini','claude'].map(k=>`<option value="${k}" ${k===p?'selected':''}>${LABEL[k]}</option>`).join('')}</select></label>
  <label>API 키<input name="key" type="password" autocomplete="off" placeholder="${key?'저장됨 · 바꾸려면 새로 입력':p==='gemini'?'AI Studio에서 만든 키':'sk-ant-...'}"></label>
  <label>모델<input name="model" list="model-options" value="${esc(modelOf(p))}"><datalist id="model-options"></datalist></label>
  <div class="tool-actions"><button class="secondary">저장</button>${p==='gemini'?'<button type="button" id="list-models" class="secondary">모델 목록 불러오기</button>':''}<button type="button" id="advisor-clear" class="secondary">키 삭제</button></div><p id="settings-status" class="muted" role="status"></p></form></details></section>`;
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
    const p=provider(),model=modelOf(p);status.textContent='AI 엔지니어들이 증거를 검토하고 있어요…';
    try{const m=p==='gemini'?await callGemini(packet,{apiKey:read(S.gemini),model}):await callClaude(packet,{apiKey:read(S.claude),model});
      global({type:'incident-meeting',source:'ai',model:`${p}:${model}`,question,...m});}
    catch(err){global({type:'incident-meeting',source:'rules',question,fallbackReason:err.message,...ruleBasedMeeting(packet)});}
  });
  const settings=content.querySelector('#advisor-settings'),sstatus=content.querySelector('#settings-status');
  settings?.querySelector('select[name=provider]')?.addEventListener('change',e=>{write(S.provider,e.target.value);rerender();});
  settings?.addEventListener('submit',e=>{e.preventDefault();const d=new FormData(settings),p=d.get('provider'),k=String(d.get('key')||'').trim(),m=String(d.get('model')||'').trim();
    write(S.provider,p);if(k)write(S[p],k);const def=p==='gemini'?A.geminiModel:A.defaultModel;write(p==='gemini'?S.geminiModel:S.claudeModel,m&&m!==def?m:'');rerender();});
  content.querySelector('#advisor-clear')?.addEventListener('click',()=>{write(S[provider()],'');rerender();});
  content.querySelector('#list-models')?.addEventListener('click',async()=>{
    const k=String(new FormData(settings).get('key')||'').trim()||read(S.gemini);if(!k){sstatus.textContent='먼저 API 키를 입력하세요.';return;}
    sstatus.textContent='모델 목록을 불러오는 중…';
    try{const list=await listGeminiModels(k);content.querySelector('#model-options').innerHTML=list.map(m=>`<option value="${esc(m)}">`).join('');
      sstatus.textContent=list.length?`쓸 수 있는 모델 ${list.length}개: ${list.slice(0,6).join(', ')}${list.length>6?' …':''} · 모델 칸을 클릭해서 고르세요.`:'쓸 수 있는 모델이 없어요.';}
    catch(err){sstatus.textContent='불러오지 못했어요: '+err.message;}
  });
}
