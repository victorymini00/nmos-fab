import {reportData} from '../systems/report.js';
export const PAPER={width:1680,height:1188,margin:54,tableTop:180,bottom:70,headerHeight:42,lineHeight:22,padding:12,fontSize:16,widths:[175,125,175,180,315,315,287]};
export function wrapText(text,width,measure){
  const lines=[];for(const paragraph of String(text).split('\n')){
    let line='';for(const char of paragraph){if(line&&measure(line+char)>width){lines.push(line);line=char;}else line+=char;}lines.push(line);
  }return lines;
}
export function paginateRows(rows,measure,p=PAPER){
  const bodyHeight=p.height-p.bottom-p.tableTop-p.headerHeight,maxLines=Math.floor((bodyHeight-2*p.padding)/p.lineHeight);
  const pages=[];let items=[],used=0;
  for(const row of rows){
    const cells=row.cells.map((text,i)=>wrapText(text,p.widths[i]-20,measure));const count=Math.max(...cells.map(c=>c.length));
    for(let start=0;start<count;start+=maxLines){
      const lineCells=cells.map(lines=>lines.slice(start,start+maxLines)),height=Math.max(...lineCells.map(c=>c.length))*p.lineHeight+2*p.padding;
      if(items.length&&used+height>bodyHeight){pages.push(items);items=[];used=0;}
      items.push({recordId:row.recordId,lineCells,height,continued:start>0});used+=height;
    }
  }if(items.length)pages.push(items);return pages;
}
const font=(ctx,size=16,bold=false)=>ctx.font=`${bold?'600':'400'} ${size}px "Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif`;
function basePage(report,page,total){
  const canvas=document.createElement('canvas');canvas.width=PAPER.width;canvas.height=PAPER.height;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#173e48';font(ctx,30,true);ctx.fillText('반도체 팹 시뮬레이터 · 최종 공정 보고서',54,62);
  font(ctx,16);ctx.fillStyle='#607b83';ctx.fillText(`${report.lotId} / 완료 ${new Date(report.completedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST`,54,99);
  ctx.strokeStyle='#b8cece';ctx.beginPath();ctx.moveTo(54,119);ctx.lineTo(1626,119);ctx.stroke();
  font(ctx,14);ctx.fillText('교육용 모델 · 실제 장비/소자 검증 필요 · 서명과 이전/재작업 이력 포함',54,1150);ctx.textAlign='right';ctx.fillText(`${page} / ${total}`,1626,1150);ctx.textAlign='left';
  return {canvas,ctx};
}
function paragraph(ctx,text,x,y,width,size=18,color='#294d57'){
  font(ctx,size);ctx.fillStyle=color;const lines=wrapText(text,width,t=>ctx.measureText(t).width);for(const line of lines){ctx.fillText(line,x,y);y+=size+8;}return y;
}
function drawGraph(ctx,r,x,y,w,h){
  const left=x+75,right=x+w-30,top=y+45,bottom=y+h-55;
  const ymax=Math.max(...r.reference.curve.map(p=>p.idA??0),...r.curve.map(p=>p.idA??0),1e-6)*1.12;
  const xx=v=>left+(v-r.conditions.vgMinV)/(r.conditions.vgMaxV-r.conditions.vgMinV)*(right-left),yy=i=>bottom-i/ymax*(bottom-top);
  font(ctx,16);ctx.fillStyle='#335b64';ctx.fillText(`Id [mA] / Vds=${r.conditions.vdsV} V / ${r.conditions.temperatureK} K`,left,y+20);
  for(let i=0;i<=4;i++){const value=ymax*i/4;ctx.strokeStyle='#deeaeb';ctx.beginPath();ctx.moveTo(left,yy(value));ctx.lineTo(right,yy(value));ctx.stroke();ctx.fillText((value*1000).toFixed(2),x+6,yy(value)+5);}
  ctx.strokeStyle='#71939a';ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,bottom);ctx.lineTo(right,bottom);ctx.stroke();
  for(const [curve,color,dash] of [[r.reference.curve,'#869ba3',[10,7]],[r.curve,'#0d8d7d',[]]]){
    ctx.strokeStyle=color;ctx.lineWidth=4;ctx.setLineDash(dash);ctx.beginPath();let begun=false;for(const p of curve){if(p.idA===null)continue;if(!begun){ctx.moveTo(xx(p.vgV),yy(p.idA));begun=true;}else ctx.lineTo(xx(p.vgV),yy(p.idA));}ctx.stroke();
  }ctx.setLineDash([]);ctx.lineWidth=1;
  for(const v of [0,1,2,3.3].filter(v=>v>=r.conditions.vgMinV&&v<=r.conditions.vgMaxV)){ctx.fillStyle='#335b64';ctx.fillText(String(v),xx(v)-5,bottom+30);}
  ctx.fillText('Vg [V]',right-60,bottom+50);ctx.fillText('점선: 기준 소자 / 실선: 공정 결과',left+330,bottom+50);
  if(!r.valid)paragraph(ctx,'연결 불량: 유효 단자 곡선 산출불가',left+150,top+150,w-300,23,'#9c4938');
}
export function renderReportPages(report){
  const measureCanvas=document.createElement('canvas'),measure=measureCanvas.getContext('2d');font(measure,PAPER.fontSize);
  const tablePages=paginateRows(report.rows,t=>measure.measureText(t).width),total=tablePages.length+2,pages=[],r=report.result;
  let {canvas,ctx}=basePage(report,1,total);ctx.fillStyle='#125e58';font(ctx,64,true);ctx.fillText(r.grade,58,205);font(ctx,22);ctx.fillText(`${r.score} / 100점`,140,197);
  font(ctx,24,true);ctx.fillStyle='#244c55';ctx.fillText(`Vt ${r.vtV.toFixed(3)} V`,440,177);ctx.fillText(`Ion ${r.ionA===null?'산출불가':(r.ionA*1000).toFixed(3)+' mA'}`,980,177);
  paragraph(ctx,`목표 ${r.reference.vtV.toFixed(3)} ±${r.specification.vtToleranceV} V`,440,211,500,17);
  paragraph(ctx,`목표 ${(r.reference.ionA*1000).toFixed(3)} mA ±${r.specification.ionToleranceFraction*100}%`,980,211,560,17);
  drawGraph(ctx,r,54,260,1572,555);
  let y=865;y=paragraph(ctx,`전체 기록 ${report.recordCount}건 / 기판 ${r.substrateCm3.toExponential(1)} cm⁻³ / 직렬 저항 ${r.resistanceOhm.toFixed(1)} Ω`,54,y,1572,20);
  y=paragraph(ctx,r.feedback[0].influence>1e-8?`가장 큰 모델 영향: ${r.feedback[0].label}`:'기준 소자와 거의 동일하며 특정 공정의 큰 이탈이 없습니다.',54,y+15,1572,22);
  paragraph(ctx,'Vt는 재료 모델 값입니다. 연결 불량이면 단자 Id–Vg를 산출하지 않습니다. 실제 전기적 측정 결과가 아닌 공정 교육용 계산입니다.',54,y+15,1572,18);pages.push(canvas);
  ({canvas,ctx}=basePage(report,2,total));font(ctx,25,true);ctx.fillStyle='#214c55';ctx.fillText('공정 영향 피드백과 모델 한계',54,165);y=207;
  for(const f of r.feedback){font(ctx,20,true);ctx.fillStyle='#285a62';ctx.fillText(`${f.label} / 상대 모델 영향 ${(f.relativeInfluence*100).toFixed(1)}%`,54,y);y+=27;
    y=paragraph(ctx,`기준 파라미터 복원 시 ΔVt ${f.deltaVtV.toFixed(3)} V / ΔIon ${f.deltaIonA===null?'연결 유효성 변화':(f.deltaIonA*1000).toFixed(3)+' mA'} / 연결 결함 ${f.blockerCount}건`,54,y,1572,16);
    y=paragraph(ctx,f.hint,54,y,1572,16);y+=16;
  }
  for(const text of r.limitations)y=paragraph(ctx,'· '+text,54,y+3,1572,15);
  paragraph(ctx,'모델 출처: iic-jku.github.io/design-complex-ic/slides/mosfet.html / dunham.ece.uw.edu/ee531/Long_Channel_MOSFET.pdf',54,1090,1572,13);pages.push(canvas);
  tablePages.forEach((items,index)=>{
    ({canvas,ctx}=basePage(report,index+3,total));font(ctx,23,true);ctx.fillStyle='#204d56';ctx.fillText(`전체 Runsheet / 기록 ${report.recordCount}건`,54,160);
    let x=54;ctx.fillStyle='#e5eeee';ctx.fillRect(x,PAPER.tableTop,1572,PAPER.headerHeight);font(ctx,16,true);ctx.fillStyle='#315b65';report.columns.forEach((name,j)=>{ctx.fillText(name,x+10,PAPER.tableTop+27);x+=PAPER.widths[j];});
    let yy=PAPER.tableTop+PAPER.headerHeight;
    for(const [i,item] of items.entries()){
      if(i%2===1){ctx.fillStyle='#f5f8f8';ctx.fillRect(54,yy,1572,item.height);}x=54;ctx.fillStyle='#274a54';font(ctx,PAPER.fontSize);
      item.lineCells.forEach((lines,j)=>{lines.forEach((line,k)=>ctx.fillText(line,x+10,yy+PAPER.padding+17+k*PAPER.lineHeight));x+=PAPER.widths[j];});
      ctx.strokeStyle='#d5e2e3';ctx.beginPath();ctx.moveTo(54,yy+item.height);ctx.lineTo(1626,yy+item.height);ctx.stroke();yy+=item.height;
    }pages.push(canvas);
  });return pages;
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export async function createReportFiles(state,flow,layout,type){
  await document.fonts.ready;const report=reportData(state,flow,layout),pages=renderReportPages(report);
  if(type==='pdf'){
    const {jsPDF}=await import('jspdf');const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
    pdf.setProperties({title:'NMOS final runsheet',subject:'Educational process simulation'});
    pages.forEach((page,index)=>{if(index)pdf.addPage('a4','landscape');pdf.addImage(page.toDataURL('image/jpeg',.94),'JPEG',0,0,297,210,undefined,'FAST');});
    return {blob:pdf.output('blob'),name:`${report.lotId}-Runsheet.pdf`,pageCount:pages.length};
  }
  if(type!=='png')throw new Error('지원하지 않는 보고서 형식입니다.');
  const {zipSync}=await import('fflate'),files={};
  for(let i=0;i<pages.length;i++){const blob=await new Promise((resolve,reject)=>pages[i].toBlob(b=>b?resolve(b):reject(new Error('PNG 저장 실패')),'image/png'));files[`Runsheet-${String(i+1).padStart(2,'0')}.png`]=new Uint8Array(await blob.arrayBuffer());}
  return {blob:new Blob([zipSync(files)],{type:'application/zip'}),name:`${report.lotId}-Runsheet-PNG.zip`,pageCount:pages.length};
}
export function bindReportExport(content,state,flow,layout){
  const buttons=[...content.querySelectorAll('#export-pdf,#export-png')],status=content.querySelector('#export-status');
  for(const button of buttons)button.addEventListener('click',async()=>{
    buttons.forEach(b=>b.disabled=true);status.textContent='전체 Runsheet 페이지를 준비하고 있습니다…';
    try{const file=await createReportFiles(state,flow,layout,button.id==='export-pdf'?'pdf':'png');download(file.blob,file.name);status.textContent=`${file.pageCount}페이지 저장 파일을 만들었습니다.`;}
    catch(error){status.textContent='저장하지 못했습니다: '+error.message;}
    finally{buttons.forEach(b=>b.disabled=false);}
  });
}
