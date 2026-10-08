const byId=id=>document.getElementById(id);
const hero=byId('top'),loop=byId('loop'),gates=byId('gates');
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp=v=>Math.max(0,Math.min(1,v));
let frame;
function update(){
  frame=null;
  for(const [scene,width,height]of [['hero',660,600],['loop',500,720],['gates',620,420]]){
    const el=document.querySelector(`[data-scene="${scene}"]`);
    if(el)el.style.setProperty('--k',Math.min(1,el.clientWidth/width,el.clientHeight/height).toFixed(3));
  }
  const h=hero.getBoundingClientRect();hero.style.setProperty('--sy',reduced.matches?0:clamp(-h.top/h.height).toFixed(3));
  const l=loop.getBoundingClientRect(),p=clamp(-l.top/Math.max(1,l.height-window.innerHeight));
  loop.style.setProperty('--p',reduced.matches?0:clamp(p*1.5+(l.top<window.innerHeight*.5?.12:0)).toFixed(3));
  for(let i=0;i<4;i++)loop.style.setProperty('--s'+i,i===Math.min(3,Math.floor(p*4))?1:0);
  if(reduced.matches||gates.getBoundingClientRect().top<window.innerHeight*.75)gates.style.setProperty('--g',1);
}
const request=()=>{if(!frame)frame=requestAnimationFrame(update);};
window.addEventListener('scroll',request,{passive:true});window.addEventListener('resize',request);reduced.addEventListener('change',request);
hero.addEventListener('pointermove',event=>{
  if(reduced.matches)return;
  const r=hero.getBoundingClientRect();hero.style.setProperty('--mx',((event.clientX-r.left)/r.width*2-1).toFixed(3));hero.style.setProperty('--my',((event.clientY-r.top)/r.height*2-1).toFixed(3));
});
hero.addEventListener('pointerleave',()=>{hero.style.setProperty('--mx',0);hero.style.setProperty('--my',0);});
const button=byId('copy-demo'),label=button.lastElementChild;label.setAttribute('aria-live','polite');
let reset;
button.addEventListener('click',async()=>{
  clearTimeout(reset);button.disabled=true;label.textContent='COPYING…';
  try{await navigator.clipboard.writeText('./ace demo');label.textContent='COPIED';}
  catch{label.textContent='SELECT COMMAND';const range=document.createRange();range.selectNodeContents(byId('demo-command'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
  finally{button.disabled=false;reset=setTimeout(()=>{label.textContent='COPY';},2400);}
});
update();document.fonts.ready.then(request);
