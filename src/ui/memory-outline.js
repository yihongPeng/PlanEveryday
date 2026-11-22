/* Reading viewport state. No timers run while idle; disposed on every view change. */
(() => {
 'use strict';
 function attach(root,id,model,persist){
  const viewport=root.querySelector('.memory-reading-scroll'),layout=root.querySelector('.memory-reading-layout');
  const sidebar=root.querySelector('.memory-toc'),list=sidebar?.querySelector('ol'),toggle=root.querySelector('[data-memory-toc-toggle]');
  const headings=[...root.querySelectorAll('.memory-body :is(h1,h2,h3,h4,h5,h6)[id]')];
  const blocks=[...root.querySelectorAll('.memory-reading-header,.memory-body :is(h1,h2,h3,h4,h5,h6,p,pre,blockquote,li,table)')];
  const links=[...(sidebar?.querySelectorAll('a')||[])],events=new AbortController();
  model.readScroll||={};model.tocCollapsed||={};
  let frame=0,active='',disposed=false,anchor=null,width=0,height=0;
  function rememberAnchor(){
   const top=viewport.getBoundingClientRect().top+16;
   let node=blocks[0];for(const block of blocks){if(block.getBoundingClientRect().top>top)break;node=block;}
   if(node)anchor={node,offset:top-node.getBoundingClientRect().top};
  }
  function savePosition(){model.readScroll[id]=viewport.scrollTop;persist();}
  function markCurrent(){
   frame=0;if(disposed||!sidebar)return;
   const top=viewport.getBoundingClientRect().top+32;
   let current=headings[0]?.id||'';
   for(const h of headings){if(h.getBoundingClientRect().top>top)break;current=h.id;}
   if(viewport.scrollTop+viewport.clientHeight>=viewport.scrollHeight-2)current=headings.at(-1)?.id||'';
   if(active===current)return;active=current;
   for(const link of links){
    const selected=link.getAttribute('href')==='#'+current;
    if(selected)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
    if(selected&&list&&!sidebar.hidden){
     const row=link.getBoundingClientRect(),box=list.getBoundingClientRect();
     if(row.top<box.top)list.scrollTop+=row.top-box.top-6;
     else if(row.bottom>box.bottom)list.scrollTop+=row.bottom-box.bottom+6;
    }
   }
  }
  function queueMark(){if(!frame)frame=requestAnimationFrame(markCurrent);}
  function disclosure(){
   if(!sidebar)return;
   const wide=root.clientWidth>=800,open=model.tocCollapsed[id]===undefined?wide:!model.tocCollapsed[id];
   layout.dataset.tocLayout=wide?'wide':'compact';layout.classList.toggle('toc-open',open);
   sidebar.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
   toggle.setAttribute('aria-label',open?'收起正文目录':'展开正文目录');queueMark();
  }
  function setOpen(open,focus){
   model.tocCollapsed[id]=!open;persist();disclosure();
   if(focus)(open?(links.find(a=>a.hasAttribute('aria-current'))||sidebar.querySelector('button')):toggle)?.focus({preventScroll:true});
  }
  viewport.addEventListener('scroll',()=>{
   // Resize can clamp scrollTop before ResizeObserver runs; retain the old paragraph anchor.
   if(viewport.clientWidth===width&&viewport.clientHeight===height){rememberAnchor();savePosition();}
   queueMark();
  },{passive:true,signal:events.signal});
  toggle?.addEventListener('click',()=>setOpen(sidebar.hidden,true),{signal:events.signal});
  sidebar?.querySelector('[data-memory-toc-close]').addEventListener('click',()=>setOpen(false,true),{signal:events.signal});
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&sidebar&&!sidebar.hidden){e.preventDefault();e.stopPropagation();setOpen(false,true);}},{signal:events.signal});
  const resize=new ResizeObserver(()=>{
   disclosure();
   if(anchor)viewport.scrollTop+=anchor.node.getBoundingClientRect().top-viewport.getBoundingClientRect().top+anchor.offset-16;
   width=viewport.clientWidth;height=viewport.clientHeight;rememberAnchor();savePosition();queueMark();
  });resize.observe(root);resize.observe(viewport);resize.observe(root.querySelector('.memory-reading'));
  disclosure();viewport.scrollTop=model.readScroll[id]||0;width=viewport.clientWidth;height=viewport.clientHeight;rememberAnchor();queueMark();
  return ()=>{if(disposed)return;savePosition();disposed=true;events.abort();resize.disconnect();cancelAnimationFrame(frame);};
 }
 window.MemoryOutline={attach};
})();
