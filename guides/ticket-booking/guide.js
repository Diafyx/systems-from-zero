const $ = id => document.getElementById(id);
const ui = {
  steps:$("steps"), number:$("step-number"), progress:$("progress-fill"),
  title:$("step-title"), lead:$("step-summary"), route:$("route"), signal:$("signal"), layers:$("layers"),
  from:$("handoff-from"), to:$("handoff-to"), message:$("handoff-message"), state:$("handoff-state"),
  why:$("step-why"), build:$("step-tech"), inside:$("step-inside"), failure:$("step-failure"),
  rule:$("takeaway"), source:$("step-source"), previous:$("previous"), next:$("next")
};
let current = 0;
ui.steps.innerHTML = steps.map((step,index) =>
  '<button type="button" role="tab" aria-controls="step-content" aria-selected="false" tabindex="-1" data-step="'+index+'"><span>'+
  String(index+1).padStart(2,"0")+'</span>'+step.name+'</button>'
).join("");
function render(){
  const step=steps[current];
  ui.number.textContent="STEP "+String(current+1).padStart(2,"0")+" OF "+steps.length;
  ui.progress.style.width=((current+1)/steps.length*100)+"%";
  ui.title.textContent=step.title;ui.lead.textContent=step.lead;ui.signal.textContent=step.signal;
  ui.from.textContent=step.from;ui.to.textContent=step.to;ui.message.textContent=step.message;
  ui.state.textContent=step.state;ui.why.textContent=step.why;ui.build.textContent=step.build;
  ui.inside.textContent=step.inside;ui.failure.textContent=step.failure;ui.rule.textContent=step.rule;
  ui.source.textContent=sources[step.source][0];ui.source.href=sources[step.source][1];
  ui.previous.disabled=current===0;
  ui.next.textContent=current===steps.length-1?"Start again ↺":"Next step →";
  ui.steps.querySelectorAll("button").forEach((button,i)=>{const active=i===current;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1});
  const active=participants.filter(node=>node.added<=current&&(node.removed===undefined||current<node.removed));
  ui.route.innerHTML=active.map((node,i)=>
    '<div class="route-node'+(step.focus.includes(node.name)?' is-focus':'')+(node.added===current?' is-new':'')+
    '"><span class="route-index">'+String(i+1).padStart(2,"0")+'</span><strong>'+node.name+
    '</strong><small>'+node.detail+'</small></div>'
  ).join("");
  ui.layers.innerHTML=layers.map(layer=>{
    if(layer.until!==undefined&&current>=layer.until)return "";
    const shown=layer.items.filter(item=>item.at<=current);
    if(!shown.length)return "";
    return '<div class="layer"><span>'+layer.name+'</span><p>'+
      shown.map(item=>'<strong'+(item.at===current?' class="is-new"':'')+'>'+item.label+'</strong>').join('<i aria-hidden="true">→</i>')+
      '</p></div>';
  }).join("");
}
function selectStep(index,focus=false){
  current=Math.max(0,Math.min(steps.length-1,index));render();
  const button=ui.steps.querySelectorAll("button")[current];
  if(focus)button.focus();
  if(typeof window!=="undefined"){
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(window.matchMedia("(max-width: 720px)").matches)ui.steps.scrollTo({
      left:button.offsetLeft-ui.steps.offsetLeft-(ui.steps.clientWidth-button.offsetWidth)/2,
      behavior:reduced?"auto":"smooth"
    });
    ui.title.scrollIntoView({block:"nearest",behavior:reduced?"auto":"smooth"});
  }
}
ui.steps.addEventListener("click",event=>{const button=event.target.closest("button[data-step]");if(button)selectStep(Number(button.dataset.step))});
ui.steps.addEventListener("keydown",event=>{
  const target=event.key==="ArrowRight"||event.key==="ArrowDown"?current+1:
    event.key==="ArrowLeft"||event.key==="ArrowUp"?current-1:
    event.key==="Home"?0:event.key==="End"?steps.length-1:null;
  if(target===null)return;event.preventDefault();selectStep(target,true);
});
ui.previous.addEventListener("click",()=>selectStep(current-1));
ui.next.addEventListener("click",()=>selectStep(current===steps.length-1?0:current+1));
render();

