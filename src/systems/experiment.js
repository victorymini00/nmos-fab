// AI 회의 사용/미사용 비교 실험용 기록. 개인정보 대신 참가자 코드(P01 등)만 씁니다.
export const EXPERIMENT_COLUMNS=['participant','mode','cause','diagnosis','causeOk','disposition','dispositionOk','bestDisposition','keyEvidenceFound','evidence','investigationMinutes','meetings','aiMeetings','wallSeconds','score','alarmAt','resolvedAt'];
export function experimentRow(state){
  const inc=state.incident;if(!inc?.evaluation)return null;const e=inc.evaluation;
  const start=Date.parse(inc.alarm?.at??inc.startedAt),end=Date.parse(inc.resolvedAt);
  return {participant:inc.participant??'',mode:inc.mode??'ai',cause:inc.cause,diagnosis:inc.diagnosis,causeOk:e.causeOk,disposition:inc.disposition,dispositionOk:e.dispositionOk,bestDisposition:e.bestDisposition,
    keyEvidenceFound:e.keyEvidenceFound,evidence:inc.evidence.join('|'),investigationMinutes:e.minutes,meetings:e.meetings??0,aiMeetings:e.aiMeetings??0,
    wallSeconds:Number.isFinite(start)&&Number.isFinite(end)?Math.round((end-start)/1000):'',score:e.score,alarmAt:inc.alarm?.at??'',resolvedAt:inc.resolvedAt};
}
const cell=v=>{const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
export function toCsv(rows){return [EXPERIMENT_COLUMNS.join(','),...rows.map(r=>EXPERIMENT_COLUMNS.map(c=>cell(r[c])).join(','))].join('\n');}
export function summarize(rows){
  const group=mode=>{const g=rows.filter(r=>r.mode===mode),n=g.length,avg=k=>n?g.reduce((a,r)=>a+Number(r[k]||0),0)/n:null;
    return {n,accuracy:n?g.filter(r=>r.causeOk===true||r.causeOk==='true').length/n:null,score:avg('score'),minutes:avg('investigationMinutes'),wallSeconds:avg('wallSeconds')};};
  return {ai:group('ai'),noAi:group('no-ai')};
}
