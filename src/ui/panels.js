export function createUI(root,layout,{onInteract,onClose,onReset,onRunsheet,onSection,onGuide}) {
  root.innerHTML=`
    <main id="world"></main>
    <header class="topbar"><div class="brand"><span class="brand-icon">◈</span><div><span class="eyebrow">FAB SIMULATOR / NMOS</span><h1>반도체 팹 시뮬레이터</h1></div></div><nav><button id="runsheet" class="secondary">Runsheet <kbd>R</kbd></button><button id="section" class="secondary">단면도 <kbd>C</kbd></button><span class="stage-tag">개발 06 · 3D 비주얼</span></nav></header>
    <section class="mission"><span class="eyebrow">LOT NMOS-001 / Si(100)</span><h2 id="mission-title"></h2><p id="mission-text"></p><button id="guide" class="secondary">다음 장비로 이동</button><p id="save-state" role="status">자동 저장 준비</p></section>
    <aside class="wafer-preview"><span class="eyebrow">WAFER CROSS SECTION</span><div id="mini-section"></div></aside>
    <div id="labels" aria-hidden="true"></div>
    <div class="bottom"><div class="controls"><span><kbd>W A S D</kbd> / 방향키 이동</span><span>바닥 클릭으로 이동</span></div><button id="interact" disabled>장비에 가까이 이동하세요</button><button id="reset" class="secondary">입구로</button></div>
    <div id="toast" role="status"></div>
    <dialog aria-labelledby="panel-title"><div class="panel-top"><span class="eyebrow" id="panel-kind">EQUIPMENT INTERFACE</span><button id="close" aria-label="패널 닫기">✕</button></div><h2 id="panel-title"></h2><div id="panel-content"></div><button id="return">클린룸으로 돌아가기 <kbd>Esc</kbd></button></dialog>`;
  const dialog=root.querySelector('dialog'),button=root.querySelector('#interact');
  let previousFocus=null,toastTimer;
  button.addEventListener('click',onInteract);
  for(const [id,callback] of Object.entries({reset:onReset,runsheet:onRunsheet,section:onSection,guide:onGuide}))root.querySelector(`#${id}`).addEventListener('click',callback);
  const close=()=>{if(!dialog.open)return;dialog.close();onClose();previousFocus?.focus();};
  root.querySelector('#close').addEventListener('click',close);root.querySelector('#return').addEventListener('click',close);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  const labels=layout.equipment.map((spec,i)=>{const el=document.createElement('div');el.className='equipment-label';const small=document.createElement('span');small.textContent=String(i+1).padStart(2,'0');el.append(small,document.createTextNode(spec.name));root.querySelector('#labels').append(el);return {spec,el};});
  return {
    container:root.querySelector('#world'),content:root.querySelector('#panel-content'),
    nearby(e){button.disabled=!e;button.textContent=e?`${e.name} · 장비 열기 [E]`:'장비에 가까이 이동하세요';},
    show(title,kind,wide=false){root.querySelector('#panel-title').textContent=title;root.querySelector('#panel-kind').textContent=kind;dialog.classList.toggle('wide',wide);if(!dialog.open){previousFocus=document.activeElement;dialog.showModal();root.querySelector('#return').focus();}},
    get isOpen(){return dialog.open;},
    message(text){const el=root.querySelector('#toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);},
    mission(title,text,guidedId){root.querySelector('#mission-title').textContent=title;root.querySelector('#mission-text').textContent=text;root.querySelector('#guide').disabled=!guidedId;for(const {spec,el} of labels)el.classList.toggle('next',spec.id===guidedId);},
    mini(html){root.querySelector('#mini-section').innerHTML=html;},
    saved(ok){root.querySelector('#save-state').textContent=ok?'진행 상황 자동 저장됨':'저장 불가 · 현재 창에서 계속 진행';},
    update({camera,nearby}){for(const {spec,el} of labels){const p=camera.position.clone().set(spec.position[0],spec.size[1]+.6,spec.position[1]).project(camera);el.style.left=`${(p.x+1)/2*innerWidth}px`;el.style.top=`${(1-p.y)/2*innerHeight}px`;el.hidden=p.z< -1||p.z>1||Math.abs(p.x)>1.15||Math.abs(p.y)>1.15;el.classList.toggle('active',nearby?.id===spec.id);}}
  };
}
