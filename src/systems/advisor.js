import {ADVISOR as A,METROLOGY as M,INCIDENT2 as Q} from '../constants.js';
import {CHECKS as CHECKS2} from './incident002.js';
import {operationsEvidence} from './campaign.js';
// AI 부서 회의에 넘길 정보는 "플레이어가 관측한 증거"뿐입니다.
// 숨은 원인(incident.cause), 장비 숨은 상태(hidden, siteFactors, biasNm), 실제 두께는 절대 넣지 않습니다.
export const ROLE_LABELS={PE:'공정 엔지니어 (PE)',EE:'설비 엔지니어 (EE)',MET:'계측 엔지니어 (MET)',QA:'품질보증 (QA)',PC:'생산관리 (PC)'};
// 캠페인(고객 주문) Lot이면 QA·생산관리가 회의에 추가됩니다.
export const CAMPAIGN_ROLES=['QA','PC'];
export const rolesFor=p=>p?.evidence?.some(e=>e.id==='OPS')?[...A.roles,...CAMPAIGN_ROLES]:[...A.roles];
const ALL_ROLES=[...A.roles,...CAMPAIGN_ROLES];
// 운영 정보는 게임 원장이 계산한 값만 넣습니다(플레이어가 패널에서 보는 값과 같음).
function withOperations(packet,state,flow){
  if(!state.campaign||!flow)return packet;
  const ops=operationsEvidence(state,flow);if(!ops)return packet;
  const maint=state.records.filter(r=>r.operationId==='campaign-maintenance').map((r,i)=>({id:`PM${i+1}`,type:'maintenance',item:r.result.label,target:r.result.target,finding:r.result.finding}));
  return {...packet,evidence:[...packet.evidence,...maint,ops]};
}
const r1=v=>Math.round(v*10)/10;
// INCIDENT 002: 증상(OPEN), 모델 기반 예상 특성, 실행한 검사 결과만. 숨은 원인·미실행 검사·장비 내부 상태 제외.
function packet002(state,question){
  const inc=state.incident,r=state.electrical,ids={history:'H','contact-chain':'C','metal-continuity':'W','probe-reseat':'P'},n={};
  const evidence=inc.checks.map(c=>{const id=`${ids[c.kind]}${n[c.kind]=(n[c.kind]??0)+1}`,res=c.result;
    if(c.kind==='history')return {id,type:'process-history',records:res.lines,note:res.note};
    return {id,type:c.kind,label:CHECKS2[c.kind].label,result:res.reading};});
  for(const m of state.records.filter(x=>x.operationId==='incident2-action'))evidence.push({id:`A${evidence.filter(e=>e.type==='action').length+1}`,type:'action',disposition:m.result.disposition});
  return {questId:inc.id,quest:inc.title,step:'최종 전기적 테스트',symptom:{measurement:'OPEN',currentFloorA:Q.currentFloorA,conditions:inc.alarm?.conditions??r?.conditions??null},
    modelExpectation:r?.reference?{vtV:Math.round(r.reference.vtV*1000)/1000,ionMilliA:Math.round(r.reference.ionA*1e6)/1000,note:'공정 이력으로 계산한 예상값이며 실제 측정값이 아님'}:null,
    evidence,investigationMinutes:inc.minutes,question:String(question??'').slice(0,A.maxTextLength)};
}
export function buildEvidencePacket(state,question='',flow=null){
  if(state.incident?.id==='INCIDENT-002')return withOperations(packet002(state,question),state,flow);
  const inc=state.incident,field=[...state.records].reverse().find(r=>r.operationId==='field-oxidation'&&!r.superseded);
  const evidence=[];let i=0;
  for(const m of field?.measurements??[])evidence.push({id:`M${++i}`,type:'thickness-measurement',sites:m.observed.map(o=>({site:o.name,nm:o.valueNm})),meanNm:r1(m.meanNm),nonuniformityPct:m.nonuniformity===null?null:r1(m.nonuniformity*100),sitesMeasured:m.observed.length});
  let j=0;for(const r of state.records.filter(r=>r.operationId==='metrology-reference'))evidence.push({id:`R${++j}`,type:'reference-sample',certifiedNm:r.result.certifiedNm,readingsNm:r.result.readings,meanNm:r1(r.result.meanNm),offsetNm:r1(r.result.offsetNm)});
  let k=0;for(const r of state.records.filter(r=>r.operationId==='incident-log'))evidence.push({id:`L${++k}`,type:'furnace-log',recipeMinutes:r.result.recipeMinutes,loggedRunMinutes:r1(r.result.actualMinutes),temperatureC:r.result.temperatureC,ambient:r.result.ambient,note:r.result.note});
  let c=0;for(const r of state.records.filter(r=>r.operationId==='metrology-calibration'))evidence.push({id:`C${++c}`,type:'metrology-calibration'});
  return withOperations({questId:inc?.id??null,quest:inc?.title??null,step:'Field 산화 (습식)',targetNm:inc?.alarm?r1(inc.alarm.targetNm):null,tolerancePct:10,
    recipe:field?{temperatureC:field.input.temperatureC,timeMinutes:field.input.timeMinutes,ambient:field.input.ambient}:null,
    alarm:inc?.alarm?{meanNm:r1(inc.alarm.meanNm),outOfSpecSites:inc.alarm.outSites}:null,evidence,
    metrologyTool:{sitesSinceCalibration:state.metrology.sitesSinceCalibration,calibrations:state.metrology.calibrations,referenceChecks:state.metrology.referenceChecks,repeatability1SigmaNm:Math.max(M.repeatabilityFloorNm,(inc?.alarm?.targetNm??0)*M.repeatabilityFraction)},
    investigationMinutes:inc?.minutes??0,question:String(question??'').slice(0,A.maxTextLength)},state,flow);
}
// 규칙 기반 회의: AI를 쓸 수 없을 때의 대체 수단. 증거가 없으면 판단을 보류합니다.
function rules002(p){
  const last=t=>p.evidence.filter(e=>e.type===t).at(-1),cc=last('contact-chain'),mc=last('metal-continuity'),pr=last('probe-reseat'),hist=last('process-history');
  const isOpen=e=>/OPEN/.test(e.result);
  const pe=cc&&isOpen(cc)?{hypothesis:'Contact 체인이 OPEN입니다. Contact 바닥 잔사로 S/D와 배선이 끊겼을 가능성이 높습니다.',basis:[cc.id],next:'Contact 식각 시간·과식각 비율과 검사 위치 재검토',confidence:'high'}
    :mc&&isOpen(mc)?{hypothesis:'배선 패턴이 OPEN입니다. Metal 단선 가능성이 높습니다.',basis:[mc.id],next:'Metal 식각 잔류·박리 기록과 두께 최솟값 재검토',confidence:'high'}
    :hist?{hypothesis:'공정 검사는 샘플 위치 기준으로 합격했지만, 테스트 소자 위치의 결함까지 보장하지는 않습니다.',basis:[hist.id],next:'Contact 체인 또는 배선 연속성 검사로 소자 내부 연결 확인',confidence:'low'}
    :{hypothesis:'어느 공정에서 끊겼는지 판단할 근거가 아직 없습니다.',basis:[],next:'공정 이력 검토 후 연결 구조 검사',confidence:'low'};
  const ee=pr?(/측정됨/.test(pr.result)?{hypothesis:'재접촉 후 전류가 돌아왔습니다. 소자가 아니라 프로브 접촉 문제였을 가능성이 높습니다.',basis:[pr.id],next:'탐침 상태·패드 접촉 점검 후 재측정으로 검증',confidence:'high'}:{hypothesis:'재접촉해도 OPEN입니다. 테스트 장비 접촉 문제 가능성은 낮습니다.',basis:[pr.id],next:'소자 내부 연결(Contact·배선) 검사',confidence:'medium'})
    :{hypothesis:'측정 탐침 접촉 불량을 배제하지 않았습니다. 가장 싸고 빠른 확인입니다.',basis:[],next:'프로브 재접촉 후 재측정',confidence:'low'};
  const met=cc&&!isOpen(cc)&&mc&&!isOpen(mc)?{hypothesis:'Contact 체인과 배선 연속성이 모두 정상입니다. 소자 내부 연결은 끊기지 않았습니다.',basis:[cc.id,mc.id],next:'테스트 접촉 쪽을 확인',confidence:'medium'}
    :cc||mc?{hypothesis:`${[cc&&`Contact 체인: ${cc.result}`,mc&&`배선: ${mc.result}`].filter(Boolean).join(' / ')}`,basis:[cc?.id,mc?.id].filter(Boolean),next:cc&&mc?'결과가 가리키는 원인으로 판정':!cc?'Contact 체인 검사':'배선 연속성 검사',confidence:(cc&&isOpen(cc))||(mc&&isOpen(mc))?'high':'medium'}
    :{hypothesis:'OPEN 증상만으로는 Contact·배선·프로브 중 어디가 끊겼는지 구분할 수 없습니다.',basis:[],next:'싼 검사(프로브 재접촉)부터, 이후 연결 구조 검사',confidence:'low'};
  const strong=[pe,ee,met].filter(o=>o.confidence==='high').length;
  return {opinions:[{role:'PE',...pe},{role:'EE',...ee},{role:'MET',...met}],summary:strong?'근거가 있는 가설이 있습니다. 다른 검사 결과와 모순되지 않는지 확인하세요.':'아직 원인을 확정할 근거가 없습니다. 비용이 적은 검사부터 진행하세요.'};
}
// QA·생산관리 규칙 기반 의견: OPS 항목의 숫자를 그대로 인용만 합니다.
function campaignOpinions(p,base){
  const ops=p.evidence.find(e=>e.id==='OPS');if(!ops)return base;
  const q=ops.confirmedQuality,unsure=ops.estimate.uncertain.length,slack=r1(ops.dueMinutes-ops.estimate.etaMinutes);
  const open=/측정 불가/.test(q.finalElectrical??'');
  const qa={role:'QA',hypothesis:/HOLD/.test(ops.hold)&&!/해제/.test(ops.hold)?`${ops.hold}. 원인 판정 전에는 다음 공정 진행이나 출하를 하지 않습니다. 확인된 품질: 검사 합격 ${q.inspectionsPassed}건, 결함 인지 ${q.defectsAccepted.length}건.`:open?'최종 전기적 테스트가 측정 불가라 주문 규격 적합을 확인할 수 없습니다. 이 상태로는 출하 대상이 아닙니다.':`확인된 품질: 검사 합격 ${q.inspectionsPassed}건, 결함 인지 ${q.defectsAccepted.length}건. 최종 규격 판정은 전기적 테스트 후에 가능합니다.`,
    basis:['OPS'],next:'판정에 필요한 핵심 증거를 확보한 뒤 결정 · 필수 계측·서명은 생략 불가',confidence:'medium'};
  const cheap=[...ops.optionPrices].sort((a,b)=>a.cost-b.cost)[0];
  const pc={role:'PC',hypothesis:`납기까지 가상 ${ops.minutesToDue}분, 예산 잔여 ${ops.remainingBudget}. 예상 완료 ${ops.estimate.etaMinutes}분(납기 대비 ${slack>=0?'+':''}${slack}분)${unsure?`, 미확정 요인 ${unsure}개라 더 늦어질 수 있음`:''}.`,
    basis:['OPS'],next:slack<0?'기한 초과 예상: 고객 납기 협의를 준비하되 검사 축소로 맞추지 않음':cheap?`여유 안에서 비용이 적은 확인부터 (예: ${cheap.option} ${cheap.minutes}분·비용 ${cheap.cost})`:'계획대로 진행',confidence:unsure?'low':'medium'};
  return {...base,opinions:[...base.opinions,qa,pc]};
}
export function ruleBasedMeeting(p){return campaignOpinions(p,baseRules(p));}
function baseRules(p){
  if(p.questId==='INCIDENT-002')return rules002(p);
  const ref=p.evidence.filter(e=>e.type==='reference-sample').at(-1),log=p.evidence.filter(e=>e.type==='furnace-log').at(-1);
  const maps=p.evidence.filter(e=>e.type==='thickness-measurement'&&e.sitesMeasured===5),map=maps.at(-1);
  let outlier=null;if(map){const v=map.sites.map(s=>s.nm).sort((a,b)=>a-b),med=v[2];const far=map.sites.map(s=>({...s,d:s.nm-med})).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d))[0];if(Math.abs(far.d)>Math.max(5,.05*med))outlier=far;}
  const overrun=log&&log.loggedRunMinutes>log.recipeMinutes+.5,biased=ref&&Math.abs(ref.offsetNm)>3;
  const pe=overrun?{hypothesis:`산화로가 레시피(${log.recipeMinutes}분)보다 오래(${log.loggedRunMinutes}분) 가동돼 실제로 과성장했을 가능성이 높습니다.`,basis:[log.id],next:'두께가 전체적으로 균일하게 두꺼운지 5점 측정으로 교차 확인',confidence:'high'}
    :outlier?{hypothesis:`${outlier.site} 지점만 중앙값보다 ${r1(outlier.d)} nm 벗어났습니다. 국부 성장 이상을 의심합니다.`,basis:[map.id],next:'산화로 로그로 전체 공정 조건이 정상이었는지 확인',confidence:'medium'}
    :{hypothesis:'레시피대로 진행됐는지 아직 확인하지 않아 공정 원인을 판단하기 어렵습니다.',basis:[],next:'산화로 공정 로그 조회',confidence:'low'};
  const ee=log?(overrun?{hypothesis:'단계 타이머가 레시피 시간을 지키지 않았습니다. 설비 점검이 필요합니다.',basis:[log.id],next:'산화로 타이머 점검 요청 후 다음 Lot 투입 보류',confidence:'high'}:{hypothesis:'산화로 로그는 레시피와 일치합니다. 산화로 설비 문제 가능성은 낮습니다.',basis:[log.id],next:'계측 장비 상태 확인',confidence:'medium'})
    :{hypothesis:'설비 기록을 보기 전에는 산화로 고장을 배제할 수 없습니다.',basis:[],next:'산화로 공정 로그와 단계 시간 확인',confidence:'low'};
  const met=ref?(biased?{hypothesis:`기준 시료가 인증값보다 ${ref.offsetNm>0?'+':''}${ref.offsetNm} nm 읽혔습니다. 계측기 편향이 유력합니다.`,basis:[ref.id],next:'계측 장비 교정 후 웨이퍼 재측정',confidence:'high'}:{hypothesis:`기준 시료 편차가 ${ref.offsetNm} nm로 작습니다. 측정값은 믿을 만합니다.`,basis:[ref.id],next:map?'측정값을 실제 두께로 보고 공정 원인을 판단':'5점 측정으로 분포 확인',confidence:'medium'})
    :{hypothesis:'기준 시료를 재기 전에는 계측 오류 가능성을 배제할 수 없습니다.',basis:[],next:'기준 시료 측정',confidence:'low'};
  if(!map&&!outlier)met.next+=' · 측정 지점이 5곳 미만이면 국부 이상을 놓칠 수 있습니다';
  const strong=[pe,ee,met].filter(o=>o.confidence==='high').length;
  return {opinions:[{role:'PE',...pe},{role:'EE',...ee},{role:'MET',...met}],summary:strong?'근거가 확보된 가설이 있습니다. 서로 모순되지 않는지 확인하고 판정하세요.':'아직 결정적인 증거가 없습니다. 부서별 제안 중 비용이 적은 확인부터 진행하세요.'};
}
export const SYSTEM_PROMPT_002=`너는 반도체 팹의 긴급 품질 회의에 참석한 세 명의 엔지니어다: PE(공정), EE(설비·테스트 장비), MET(계측·테스트 구조).
상황: 교육용 시뮬레이터에서 완성된 NMOS의 최종 전기적 테스트 결과가 OPEN(전류 측정 하한 미만)이다. 원인 후보는 소자 내부 연결 결함 또는 테스트 접촉 문제다.
규칙:
1. 사용자 메시지의 JSON "증거 패킷"에 있는 정보만 근거로 삼는다. 실행하지 않은 검사의 결과를 추측해 사실처럼 말하지 않는다.
2. 각 주장마다 근거로 쓴 증거 id(H1, C1, W1, P1, A1 등)를 basis에 적는다. 근거가 없으면 basis를 빈 배열로 두고 confidence를 low로 한다.
3. modelExpectation은 공정 모델로 계산한 예상값이지 실제 측정값이 아니다. 이를 소자가 정상이라는 증거로 쓰지 않는다.
4. 정답을 단정하지 않는다. 가설, 다음에 확인할 검사, 검사 비용(시간)을 고려한 순서를 제안한다.
5. 이미 끊긴 배선이나 Contact를 즉시 복구할 수 있다고 말하지 않는다.
6. 플레이어 질문(question)이 있으면 summary에서 짧게 답한다.
7. 한국어, 짧게. 아래 JSON만 출력한다(설명·코드블록 없이).
{"opinions":[{"role":"PE","hypothesis":"...","basis":["C1"],"next":"...","confidence":"low|medium|high"},{"role":"EE",...},{"role":"MET",...}],"summary":"..."}`;
export const CAMPAIGN_ADDENDUM=`
추가 상황: 이 Lot은 고객 주문(완료 기한·예산·최종 전기 규격)이 걸린 운영 캠페인이다. 회의에 QA(품질보증)와 PC(생산관리)도 참석한다.
추가 규칙:
A. 시간·비용·납기·예산·예상 완료 숫자는 증거 OPS 항목에 있는 값만 인용한다. 새 비용·시간·수율·가동률·품질 결과를 계산하거나 지어내지 않는다.
B. QA는 OPS의 confirmedQuality와 orderSpec만 보고 말한다. 주문 규격 적합이 확인되지 않은 제품의 출하를 권하지 않는다.
C. PC는 남은 시간(minutesToDue), 예산(remainingBudget), 선택지별 시간·비용(optionPrices)으로 순서를 제안한다. 필수 계측·서명 생략이나 검사 축소로 납기를 맞추는 방법은 제안하지 않는다.
D. 정비는 이미 가공된 웨이퍼를 고치지 못한다. 정비 효과를 과장하지 않는다.
E. QA·PC 의견의 basis에는 OPS를 넣는다. opinions는 PE, EE, MET, QA, PC 다섯 개를 이 순서로 출력한다.`;
export const systemPromptFor=p=>(p?.questId==='INCIDENT-002'?SYSTEM_PROMPT_002:SYSTEM_PROMPT)+(rolesFor(p).length>3?CAMPAIGN_ADDENDUM:'');
export const SYSTEM_PROMPT=`너는 반도체 팹의 긴급 품질 회의에 참석한 세 명의 엔지니어다: PE(공정), EE(설비), MET(계측).
상황: 교육용 시뮬레이터의 NMOS Field 습식 산화 후 두께 측정에서 OOS 경고가 떠서 Lot을 HOLD했다.
규칙:
1. 사용자 메시지의 JSON "증거 패킷"에 있는 정보만 근거로 삼는다. 패킷에 없는 측정값·로그·사실을 만들어내지 않는다.
2. 각 주장마다 근거로 쓴 증거 id(M1, R1, L1, C1 등)를 basis에 적는다. 근거 증거가 없으면 basis를 빈 배열로 두고 confidence를 low로 한다.
3. 정답을 단정하지 않는다. 가설과 다음에 확인할 것을 제안한다. 서로 다른 관점(공정·설비·계측)에서 말한다.
4. 반복 정밀도(repeatability1SigmaNm)보다 작은 차이는 의미 있는 차이로 해석하지 않는다.
5. 플레이어 질문(question)이 있으면 summary에서 짧게 답한다.
6. 한국어, 각 문장은 짧게. 아래 JSON만 출력한다(설명·코드블록 없이).
{"opinions":[{"role":"PE","hypothesis":"...","basis":["M1"],"next":"...","confidence":"low|medium|high"},{"role":"EE",...},{"role":"MET",...}],"summary":"..."}`;
// AI 응답 검증: 형식, 길이, 존재하지 않는 증거 id 제거.
export function sanitizeMeeting(raw,packet){
  const ids=new Set(packet.evidence.map(e=>e.id)),clip=v=>String(v??'').slice(0,A.maxTextLength);
  const text=typeof raw==='string'?raw:JSON.stringify(raw);const start=text.indexOf('{'),end=text.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  const data=JSON.parse(text.slice(start,end+1));if(!Array.isArray(data.opinions))throw new Error('AI 응답 형식이 올바르지 않습니다.');
  const opinions=rolesFor(packet).map(role=>{const o=data.opinions.find(o=>o?.role===role);if(!o)throw new Error(`${role} 의견이 없습니다.`);
    const basis=(Array.isArray(o.basis)?o.basis:[]).map(String),valid=basis.filter(b=>ids.has(b)),invented=basis.filter(b=>!ids.has(b));
    return {role,hypothesis:clip(o.hypothesis),basis:valid,inventedBasis:invented,next:clip(o.next),confidence:['low','medium','high'].includes(o.confidence)?(valid.length?o.confidence:'low'):'low'};});
  return {opinions,summary:clip(data.summary)};
}
export async function callClaude(packet,{apiKey,model=A.defaultModel,fetchFn=globalThis.fetch}){
  const res=await fetchFn(A.apiUrl,{method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':A.apiVersion,'anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({model,max_tokens:A.maxTokens,system:systemPromptFor(packet),messages:[{role:'user',content:`증거 패킷:\n${JSON.stringify(packet)}`}]})});
  const body=await res.json().catch(()=>null);
  if(!res.ok)throw new Error(body?.error?.message??`API 오류 (${res.status})`);
  const text=(body?.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  return sanitizeMeeting(text,packet);
}
// 상태에 기록할 회의 결과 검증(저장 재생 시에도 동일 규칙)
export function validateMeetingAction(action){
  if(!['ai','rules'].includes(action.source))throw new Error('회의 출처가 올바르지 않습니다.');
  if(!Array.isArray(action.opinions)||![3,5].includes(action.opinions.length))throw new Error('부서 의견 수가 올바르지 않습니다.');
  const clip=v=>String(v??'').slice(0,A.maxTextLength);
  return {source:action.source,model:action.source==='ai'?clip(action.model):null,question:clip(action.question),summary:clip(action.summary),fallbackReason:action.fallbackReason?clip(action.fallbackReason):null,
    opinions:action.opinions.map(o=>({role:ALL_ROLES.includes(o.role)?o.role:'PE',hypothesis:clip(o.hypothesis),basis:(o.basis??[]).slice(0,8).map(clip),inventedBasis:(o.inventedBasis??[]).slice(0,8).map(clip),next:clip(o.next),confidence:['low','medium','high'].includes(o.confidence)?o.confidence:'low'}))};
}

// Gemini API(무료 등급 가능). 키는 헤더로만 보내고 URL·본문에는 넣지 않습니다.
export async function callGemini(packet,{apiKey,model=A.geminiModel,fetchFn=globalThis.fetch}){
  const id=String(model).replace(/^models\//,'');
  if(!/^[A-Za-z0-9._-]+$/.test(id))throw new Error('모델 이름 형식이 올바르지 않습니다.');
  const res=await fetchFn(`${A.geminiBase}/models/${id}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':apiKey},
    body:JSON.stringify({systemInstruction:{parts:[{text:systemPromptFor(packet)}]},contents:[{role:'user',parts:[{text:`증거 패킷:\n${JSON.stringify(packet)}`}]}],
      generationConfig:{responseMimeType:'application/json',maxOutputTokens:A.geminiMaxTokens,temperature:.4}})});
  const body=await res.json().catch(()=>null);
  if(!res.ok)throw new Error(body?.error?.message??`API 오류 (${res.status})`);
  const cand=body?.candidates?.[0];
  if(!cand)throw new Error(body?.promptFeedback?.blockReason?`응답 차단: ${body.promptFeedback.blockReason}`:'AI 응답이 비어 있습니다.');
  const text=(cand.content?.parts??[]).filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('');
  if(!text)throw new Error(`AI 응답이 비어 있습니다 (${cand.finishReason??'알 수 없음'}).`);
  return sanitizeMeeting(text,packet);
}
// 이 키로 쓸 수 있는 텍스트 생성 모델 목록(무료 등급에서 열린 모델 확인용)
export async function listGeminiModels(apiKey,fetchFn=globalThis.fetch){
  const out=[];let token='';
  for(let page=0;page<5;page++){
    const res=await fetchFn(`${A.geminiBase}/models?pageSize=100${token?`&pageToken=${encodeURIComponent(token)}`:''}`,{headers:{'x-goog-api-key':apiKey}});
    const body=await res.json().catch(()=>null);if(!res.ok)throw new Error(body?.error?.message??`API 오류 (${res.status})`);
    for(const m of body.models??[])if((m.supportedGenerationMethods??[]).includes('generateContent'))out.push(String(m.name).replace(/^models\//,''));
    token=body.nextPageToken;if(!token)break;
  }
  return out.sort((a,b)=>(/flash/.test(b)-/flash/.test(a))||b.localeCompare(a));
}
