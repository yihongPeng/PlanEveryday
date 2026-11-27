/* Reading viewport state. No timers run while idle; disposed on every view change. */
(() => {
 'use strict';
 function attach(root,id,model,persist){
  const viewport=root.querySelector('.memory-reading-scroll'),layout=root.querySelector('.memory-reading-layout');
  const sidebar=root.querySelector('.memory-toc'),list=sidebar?.querySelector('ol'),toggle=root.querySelector('[data-memory-toc-toggle]');
  const headings=[...root.querySelectorAll('.memory-body :is(h1,h2,h3,h4,h5,h6)[id]')];
  const blocks=[...root.querySelectorAll('.memory-reading-header,.memory-body :is(h1,h2,h3,h4,h5,h6,p,pre,blockquote,li,table)')];
  const links=[...(sidebar?.querySelectorAll('a')||[])],events=new AbortController();
  model.readScroll||={};model.tocCollapsed||={};model.tocBranches||={};
  const rows=new Map([...(list?.children||[])].map(row=>[row.dataset.heading,row]));
  const folded=new Set((model.tocBranches[id]||[]).filter(key=>rows.get(key)?.querySelector('button')));
  let frame=0,active='',disposed=false,anchor=null,width=0,height=0;
  function showBranches(){
   for(const [key,row] of rows){
    const parent=row.dataset.parent,button=row.querySelector('button');
    row.hidden=!!parent&&(folded.has(parent)||rows.get(parent).hidden);
    if(button){
     button.setAttribute('aria-expanded',String(!folded.has(key)));
     button.setAttribute('aria-label',(folded.has(key)?'展开':'收起')+' '+row.querySelector('a').textContent+' 的子目录');
    }
   }
   active='';queueMark();
  }
  if(list){
   showBranches();
   list.addEventListener('click',event=>{
    const button=event.target.closest('.memory-branch');if(!button)return;
    const key=button.parentElement.dataset.heading;
    if(folded.has(key))folded.delete(key);else folded.add(key);
    model.tocBranches[id]=[...folded];persist();showBranches();
   },{signal:events.signal});
  }
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
   while(rows.get(current)?.hidden)current=rows.get(current).dataset.parent;
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
 // Resolve a reading position against this Markdown block, even when the same
 // heading or sentence also appears elsewhere in the note.
 function readingOffset(root,source){
  const viewport=root.querySelector('.memory-reading-scroll');
  const lineY=viewport.getBoundingClientRect().top+17;
  let block;
  for(const candidate of root.querySelectorAll('.memory-body [data-source-start]')){
   const box=candidate.getBoundingClientRect();
   if(box.bottom<=lineY)continue;
   if(box.top>lineY){block||=candidate;break;}
   block=candidate;
  }
  if(!block)return viewport.scrollTop?source.length:0;
  const starts=[0];for(let i=0;i<source.length;i++)if(source[i]==='\n')starts.push(i+1);
  const start=starts[Number(block.dataset.sourceStart)]??0;
  const end=starts[Number(block.dataset.sourceEnd)]??source.length;
  if(lineY<=block.getBoundingClientRect().top+3)return start;
  const raw=source.slice(start,end),walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
  const range=document.createRange();let consumed=0;
  while(walker.nextNode()){
   const node=walker.currentNode,value=node.data;if(!value.trim())continue;
   const index=raw.indexOf(value,consumed);
   if(index>=0)consumed=index+value.length;
   range.selectNodeContents(node);
   if(range.getBoundingClientRect().bottom<=lineY)continue;
   let lo=0,hi=value.length-1;
   while(lo<hi){
    const mid=(lo+hi)>>>1;range.setStart(node,mid);range.setEnd(node,mid+1);
    if(range.getBoundingClientRect().bottom>lineY)hi=mid;else lo=mid+1;
   }
   if(index>=0)return start+index+lo;
   // Escapes and HTML entities can change the displayed text. Match a short
   // visible fragment before falling back to the beginning of this block.
   const snippet=value.slice(lo,lo+24),match=raw.indexOf(snippet,consumed);
   return match>=0?start+match:start;
  }
  return start;
 }
 function draftOffset(source,draft,offset){
  if(source===draft)return offset;
  let prefix=0;
  while(prefix<Math.min(source.length,draft.length)&&source[prefix]===draft[prefix])prefix++;
  let suffix=0;
  while(suffix<Math.min(source.length,draft.length)-prefix&&source.at(-1-suffix)===draft.at(-1-suffix))suffix++;
  if(offset>=source.length-suffix&&suffix)return draft.length-(source.length-offset);
  if(offset<=prefix)return offset;
  const excerpt=source.slice(offset,offset+32),match=excerpt?draft.indexOf(excerpt,prefix):-1;
  return match>=0?match:Math.min(offset,draft.length-suffix);
 }
 function focusSource(editor,source,offset){
  const draft=editor.value,position=draftOffset(source,draft,offset);
  editor.focus({preventScroll:true});editor.setSelectionRange(position,position);
  editor.scrollIntoView({block:'nearest',behavior:'instant'});
  // Measure the caret with the textarea's actual wrapping width and font.
  const mirror=document.createElement('div'),marker=document.createElement('span');
  const style=getComputedStyle(editor);
  for(const key of ['font','lineHeight','letterSpacing','tabSize','wordBreak','overflowWrap','padding','whiteSpace','textIndent'])mirror.style[key]=style[key];
  Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',boxSizing:'border-box',width:editor.clientWidth+'px',border:'0'});
  marker.textContent=draft[position]||'\u200b';
  mirror.append(draft.slice(0,position),marker,draft.slice(position+1));document.body.append(mirror);
  editor.scrollTop=Math.max(0,marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top-16);
  mirror.remove();
 }
 window.MemoryOutline={attach,readingOffset,focusSource};
})();
