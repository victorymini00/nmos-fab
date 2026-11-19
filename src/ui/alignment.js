import {PHOTO as P} from '../constants.js';
import {alignmentResult} from '../systems/lithography.js';
export function bindAlignment(content){
  const board=content.querySelector('#alignment-board');if(!board)return;
  const keys=['offsetXUm','offsetYUm','rotationDeg'];
  const input=Object.fromEntries(keys.map(k=>[k,content.querySelector(`[name="${k}"]`)]));
  const update=()=>{const values=Object.fromEntries(keys.map(k=>[k,Number(input[k].value)]));const result=alignmentResult(values);
    content.querySelector('#mask-overlay').style.transform=`translate(${values.offsetXUm*6}px,${values.offsetYUm*6}px) rotate(${values.rotationDeg}deg)`;
    const status=content.querySelector('#alignment-status');status.textContent=`X ${values.offsetXUm.toFixed(2)} µm / Y ${values.offsetYUm.toFixed(2)} µm / 회전 ${values.rotationDeg.toFixed(1)}° · 최대 오차 ${result.overlayUm.toFixed(2)} µm (${result.alignmentPass?'정렬 양호':'허용 1 µm 초과'})`;
    status.className=result.alignmentPass?'aligned':'error';
  };
  Object.values(input).forEach(el=>el.addEventListener('input',update));
  board.addEventListener('keydown',e=>{
    const move={ArrowLeft:['offsetXUm',-P.alignmentStepUm],ArrowRight:['offsetXUm',P.alignmentStepUm],ArrowUp:['offsetYUm',-P.alignmentStepUm],ArrowDown:['offsetYUm',P.alignmentStepUm],KeyQ:['rotationDeg',-P.rotationStepDeg],KeyE:['rotationDeg',P.rotationStepDeg]}[e.code];
    if(!move)return;e.preventDefault();e.stopPropagation();const [k,delta]=move;input[k].value=String(Math.max(Number(input[k].min),Math.min(Number(input[k].max),Number(input[k].value)+delta)));update();
  });update();
}
