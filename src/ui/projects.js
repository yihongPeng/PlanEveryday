/* Project organization uses the same saved tasks as the daily planner. */
(() => {
 'use strict';
 const storageKey = 'planner.projects.view.v1';
 const empty = () => ({ id:null, query:'', groups:{}, projects:{}, drafts:{}, dialog:null, selection:[], listScroll:0 });
 let model=empty(), context=null, busy=false, cleanupGantt=()=>{}, listeners=null, previewTicket=0;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dateText=v=>v?`${+v.slice(5,7)}月${+v.slice(8,10)}日`:'未安排';
 const dateRange=(start,end=start)=>!start?'未安排日期':start===end?dateText(start):start.slice(0,4)!==end.slice(0,4)?`${start.slice(0,4)}年${dateText(start)}—${end.slice(0,4)}年${dateText(end)}`:`${dateText(start)}—${dateText(end)}`;
 const taskEnd=t=>t.plannedEndDate||t.plannedDate;
 const outsideStage=(t,s)=>!!(s?.startDate&&t.plannedDate&&(t.plannedDate<s.startDate||taskEnd(t)>s.endDate));
 const losesFocus=(focus,start,end)=>!!(focus&&(!start||focus<start||focus>(end||start)));
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const projects=()=>context?.state.projects||[];
 const stages=()=>context?.state.stages||context?.state.projectStages||[];
 const tasks=()=>context?.state.tasks||[];
 const project=(id=model.id)=>projects().find(p=>p.id===id);
 const stage=id=>stages().find(s=>s.id===id);
 const projectTasks=id=>tasks().filter(t=>t.projectId===(id??model.id));
 const projectStages=id=>stages().filter(s=>s.projectId===(id??model.id)).sort((a,b)=>(a.order||0)-(b.order||0)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const persist=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(model));}catch{}};
 function restoreSession(){try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved&&typeof saved==='object')model={...empty(),...saved,groups:saved.groups||{},projects:saved.projects||{},drafts:saved.drafts||{},selection:saved.selection||[]};}catch{model=empty();}}
 restoreSession();
 function session(id=model.id){return model.projects[id]||(model.projects[id]={tab:'tasks',query:'',status:'all',priority:'all',stageId:'',collapsed:{},quick:'',scroll:0,gantt:{}});}
 function captureSession(){
  const scroller=context?.container.querySelector('.project-scroll');
  if(scroller){const shownId=context.container.dataset.projectId;if(shownId)session(shownId).scroll=scroller.scrollTop;else model.listScroll=scroller.scrollTop;}
  const timeline=context?.container.querySelector('.gantt-viewport'),shownId=context?.container.dataset.projectId;
  if(timeline&&shownId){const s=session(shownId);s.gantt||(s.gantt={});s.gantt.scrollTop=timeline.scrollTop;s.gantt.scrollLeft=timeline.scrollLeft;}
  persist();
 }
 function dispose(){captureSession();cleanupGantt();cleanupGantt=()=>{};listeners?.abort();listeners=null;}
 function progress(list){return list.length?`已完成 ${list.filter(t=>t.status==='done').length}/${list.length} 项任务`:'尚无任务';}
 function range(list,phases){const dates=[...list.flatMap(t=>[t.plannedDate,taskEnd(t)]),...phases.flatMap(s=>[s.startDate,s.endDate])].filter(Boolean).sort();return dates.length?{start:dates[0],end:dates.at(-1)}:null;}
 function stageOptions(selected='',includeAll=false){return `${includeAll?'<option value="all">全部阶段</option>':''}<option value="" ${selected===''?'selected':''}>未分阶段</option>${projectStages().map(s=>`<option value="${esc(s.id)}" ${selected===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}`;}
 function shownTasks(list){const s=session(),q=(s.query||'').trim().toLocaleLowerCase();return list.filter(t=>(!q||(t.title+' '+(t.notes||'')).toLocaleLowerCase().includes(q))&&(s.status==='all'||t.status===s.status)&&(s.priority==='all'||t.priority===s.priority)).sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||({urgent:2,important:1,normal:0}[b.priority]||0)-({urgent:2,important:1,normal:0}[a.priority]||0)||a.createdAt.localeCompare(b.createdAt));}
 function filtered(){const s=session();return !!s.query||s.status!=='all'||s.priority!=='all';}
 function focus(id){context?.container.querySelector('#'+id)?.focus({preventScroll:true});}
 function renderList(){
  const q=model.query.trim().toLocaleLowerCase(),list=projects().filter(p=>(p.title+' '+(p.outcome||'')).toLocaleLowerCase().includes(q));
  const row=p=>{const list=projectTasks(p.id),phases=projectStages(p.id),next=list.filter(t=>t.status==='todo'&&t.plannedDate).sort((a,b)=>a.plannedDate.localeCompare(b.plannedDate))[0],undated=list.filter(t=>t.status==='todo'&&!t.plannedDate).length,current=phases.filter(s=>s.startDate&&s.startDate<=today()&&s.endDate>=today()).map(s=>s.title).join('、');return `<button class="project-list-row" data-project-open="${esc(p.id)}"><span class="project-row-copy"><strong>${esc(p.title)}</strong><span>${current?`${esc(current)} · `:''}${next?`${dateRange(next.plannedDate,taskEnd(next))} · ${esc(next.title)}`:undated?`${undated} 项待安排`:list.length?'暂时没有待办':'尚无任务'}</span></span><span class="project-row-meta"><span>${p.targetDate?`目标 ${dateText(p.targetDate)}`:'未设目标日'}</span><span>${progress(list)}</span></span><span class="project-row-arrow" aria-hidden="true">›</span></button>`;};
  const group=(name,title,items)=>items.length?`<section class="project-list-group"><button class="project-group-toggle" data-project-group="${name}" aria-expanded="${name==='active'||model.groups[name]||!!q}"><span aria-hidden="true">${name==='active'||model.groups[name]||q?'⌄':'›'}</span>${title}<small>${items.length}</small></button>${name==='active'||model.groups[name]||q?items.map(row).join(''):''}</section>`:'';
  return `<div class="project-list-toolbar"><label class="project-search"><span class="sr-only">搜索项目</span><input id="project-search" type="search" placeholder="搜索项目" value="${esc(model.query)}"></label><button class="primary-button" data-project-new>＋ 新建项目</button></div><div class="project-scroll" tabindex="-1">${group('active','进行中',list.filter(p=>!p.archivedAt&&p.status!=='completed'))}${group('completed','已完成',list.filter(p=>!p.archivedAt&&p.status==='completed'))}${group('archived','已归档',list.filter(p=>p.archivedAt))}${!list.length?`<div class="project-empty"><h2>${q?'没有找到匹配的项目':'还没有项目'}</h2><p>${q?'试试其他关键词，或查看全部项目。':'新建项目后，可以直接记录任务，再分阶段安排日期。'}</p><button class="secondary-button" ${q?'data-project-clear-search':'data-project-new'}>${q?'清除搜索':'新建项目'}</button></div>`:''}</div>`;
 }
 function taskGroup(item,list){
  const s=session(),id=item?.id||'',key=id||'unassigned',all=list.filter(t=>(t.stageId||'')===id),visible=shownTasks(all),collapsed=!!s.collapsed?.[key]&&!filtered();
  if(filtered()&&!visible.length)return '';
  return `<section class="project-stage" data-project-stage="${esc(id)}"><div class="project-stage-head"><button class="project-stage-toggle" data-stage-toggle="${esc(key)}" aria-expanded="${!collapsed}"><span aria-hidden="true">${collapsed?'›':'⌄'}</span><span class="project-stage-name">${esc(item?.title||'未分阶段')}</span><small>${all.length&&all.every(t=>t.status==='done')?'阶段任务已完成':progress(all)}</small></button>${item?`<button class="project-stage-date" data-stage-schedule="${esc(id)}" aria-label="调整 ${esc(item.title)} 的日期">${dateRange(item.startDate,item.endDate)}</button><button class="project-stage-edit" data-stage-edit="${esc(id)}" aria-label="编辑阶段 ${esc(item.title)}" title="编辑阶段">⋯</button>`:''}</div>${!collapsed?`${item?.outcome?`<p class="project-stage-outcome">${esc(item.outcome)}</p>`:''}<div class="project-stage-tasks">${visible.length?visible.map(t=>`<div class="project-task-wrap ${s.multi?'is-selecting':''}">${s.multi?`<label class="project-select"><input type="checkbox" data-project-select="${esc(t.id)}" aria-label="选择 ${esc(t.title)}" ${model.selection.includes(t.id)?'checked':''}></label>`:''}${context.taskRow(t)}${outsideStage(t,item)?`<p class="project-outside">安排日期在阶段范围外 <button data-detail="${esc(t.id)}">调整任务</button><button data-stage-schedule="${esc(id)}">调整阶段</button></p>`:''}</div>`).join(''):`<p class="project-group-empty">${filtered()?'此阶段没有匹配的任务':'尚无任务'}</p>`}</div><button class="project-inline-add" data-stage-add-task="${esc(id)}">＋ 添加${item?'阶段':'项目'}任务</button>`:''}</section>`;
 }
 function renderProject(p){
  const list=projectTasks(),phases=projectStages(),s=session(),bounds=range(list,phases),canComplete=list.length>0&&list.every(t=>t.status==='done');
  const projectActions='<button data-project-assign>归入已有任务</button><button data-stage-new>＋ 添加阶段</button>';
  model.selection=model.selection.filter(id=>list.some(t=>t.id===id));
  if(s.stageId&&!phases.some(x=>x.id===s.stageId))s.stageId='';
  return `<header class="project-header"><div class="project-breadcrumb"><button data-project-back>‹ 项目</button><span class="project-header-actions">${s.tab==='gantt'?projectActions:''}<button data-project-edit="${esc(p.id)}">项目设置</button></span></div><h2>${esc(p.title)}</h2><div class="project-summary"><span>${progress(list)}</span>${p.status==='completed'?'<span class="project-status">项目已完成</span>':''}${p.archivedAt?'<span class="project-status">已归档</span>':''}${p.targetDate?`<span>目标 ${dateText(p.targetDate)}</span>`:''}${bounds?`<span class="project-plan-range">当前计划 ${dateRange(bounds.start,bounds.end)}</span>`:''}</div>${p.outcome?`<details class="project-outcome" ${s.outcomeOpen?'open':''}><summary>成果说明</summary><p>${esc(p.outcome)}</p></details>`:''}${bounds&&p.targetDate&&bounds.end>p.targetDate?'<p class="project-range-note">当前安排晚于目标日</p>':''}${p.status!=='completed'&&canComplete?`<button class="project-complete" data-project-complete="${esc(p.id)}">全部任务已完成 · 完成项目</button>`:''}</header><div class="project-viewbar"><div class="project-tabs" role="tablist" aria-label="项目视图"><button role="tab" data-project-tab="tasks" aria-selected="${s.tab!=='gantt'}">任务</button><button role="tab" data-project-tab="gantt" aria-selected="${s.tab==='gantt'}">甘特图</button></div>${s.tab==='gantt'?'<div class="project-gantt-controls"></div>':`<div class="project-view-actions">${projectActions}</div>`}</div>${s.tab==='gantt'?'<div class="project-gantt-host"></div>':`<div class="project-task-tools"><form id="project-quick-form" class="project-quick-form"><label class="sr-only" for="project-task-title">新任务标题</label><input id="project-task-title" placeholder="记一件项目要做的事" autocomplete="off" value="${esc(s.quick||'')}" required><button class="primary-button" type="submit" data-project-add-task>添加</button></form><div class="project-add-meta"><label>添加到 <select id="project-new-stage">${stageOptions(s.stageId)}</select></label><span class="project-add-meta-actions"><span>默认未安排日期</span><button type="button" data-project-multi aria-pressed="${!!s.multi}">${s.multi?'结束多选':'多选'}</button></span></div><div class="project-task-filters"><label class="project-search"><span class="sr-only">搜索项目任务</span><input id="project-task-search" type="search" placeholder="搜索任务" value="${esc(s.query||'')}"></label><label class="sr-only" for="project-status-filter">任务状态</label><select id="project-status-filter"><option value="all">全部状态</option><option value="todo" ${s.status==='todo'?'selected':''}>待办</option><option value="done" ${s.status==='done'?'selected':''}>已完成</option></select><label class="sr-only" for="project-priority-filter">优先级</label><select id="project-priority-filter"><option value="all">全部优先级</option>${[['normal','普通'],['important','重要'],['urgent','紧急']].map(([k,label])=>`<option value="${k}" ${s.priority===k?'selected':''}>${label}</option>`).join('')}</select></div><p class="project-error" role="alert"></p>${model.selection.length?`<div class="project-selection-bar"><span>已选择 ${model.selection.length} 项</span><button data-project-move>归入阶段</button><button data-project-detach>移出项目</button><button data-project-selection-clear>取消选择</button></div>`:''}${filtered()?`<p class="project-filter-note">匹配 ${shownTasks(list).length} 项 · 项目共 ${list.length} 项 <button data-project-filter-clear>清除筛选</button></p>`:''}</div><div class="project-scroll" tabindex="-1">${phases.map(item=>taskGroup(item,list)).join('')}${taskGroup(null,list)}${filtered()&&!shownTasks(list).length?'<div class="project-empty"><p>没有匹配的任务</p><button data-project-filter-clear>清除筛选</button></div>':''}</div>`}`;
 }
 function draft(kind,id){const key=`${kind}:${id||'new'}`;if(!model.drafts[key]){const item=kind==='project'?project(id):stage(id);model.drafts[key]={title:item?.title||'',outcome:item?.outcome||'',targetDate:item?.targetDate||'',startDate:item?.startDate||'',endDate:item?.endDate||''};}return model.drafts[key];}
 function dialogHead(title){return `<div class="project-dialog-head"><h2 id="project-dialog-title">${esc(title)}</h2><button type="button" data-project-dialog-close aria-label="关闭（保留草稿）">×</button></div>`;}
 function dialogError(){return '<p class="project-dialog-error" role="alert"></p>';}
 function dialogFooter(text='保存'){return `<div class="project-dialog-footer"><button type="button" data-project-dialog-close>取消</button><button type="submit" class="primary-button" data-project-dialog-save>${text}</button></div>`;}
 function renderDialog(){
  const d=model.dialog;if(!d)return '';
  let body='';
  if(d.kind==='project'||d.kind==='stage'){
   const item=d.kind==='project'?project(d.id):stage(d.id),v=draft(d.kind,d.id),isProject=d.kind==='project';
   body=`${dialogHead(item?`编辑${isProject?'项目':'阶段'}`:`新建${isProject?'项目':'阶段'}`)}<form id="project-editor-form" data-editor-kind="${d.kind}"><label class="project-field" for="project-title">名称<input id="project-title" name="title" value="${esc(v.title)}" autocomplete="off" required autofocus></label><label class="project-field" for="project-outcome">成果说明 <small>选填</small><textarea id="project-outcome" name="outcome" rows="3" placeholder="希望完成什么">${esc(v.outcome)}</textarea></label>${isProject?`<label class="project-field" for="project-target-date">目标完成日 <small>选填</small><input id="project-target-date" type="date" name="targetDate" value="${esc(v.targetDate)}"></label><p class="project-help">目标日不会自动改变任务日期或创建提醒。</p>`:item?`<div class="project-stage-date-editor"><span>${dateRange(item.startDate,item.endDate)}</span><button type="button" data-stage-schedule="${esc(item.id)}">调整日期</button></div>`:`<div class="project-date-fields"><label class="project-field" for="project-stage-start">开始日<input id="project-stage-start" name="startDate" type="date" value="${esc(v.startDate)}"></label><label class="project-field" for="project-stage-end">结束日<input id="project-stage-end" name="endDate" type="date" value="${esc(v.endDate)}"></label></div><p class="project-help">日期可一起留空。阶段占一段时间，具体任务另行安排。</p>`}${dialogError()}${dialogFooter(item?'保存修改':'创建'+(isProject?'项目':'阶段'))}</form>${item?`<div class="project-editor-actions">${isProject?`${item.status==='completed'?'<button data-project-reopen>重新打开项目</button>':''}<button data-project-archive>${item.archivedAt?'恢复到项目列表':'归档项目'}</button><button class="project-danger" data-project-delete>删除项目…</button>`:`<button class="project-danger" data-stage-delete="${esc(item.id)}">删除阶段…</button>`}</div>`:''}`;
  }else if(d.kind==='confirm'){
   body=`${dialogHead(d.title)}<p class="project-confirm-copy">${esc(d.message)}</p>${dialogError()}<div class="project-dialog-footer"><button data-project-confirm-cancel>取消</button><button class="${d.danger?'project-danger-button':'primary-button'}" data-project-confirm>${esc(d.label||'确认')}</button></div>`;
  }else if(d.kind==='assign'||d.kind==='move'){
   const moving=d.kind==='move',query=(d.query||'').trim().toLocaleLowerCase(),available=tasks().filter(t=>t.projectId!==model.id).filter(t=>(t.title+' '+(project(t.projectId)?.title||'')).toLocaleLowerCase().includes(query));
   body=`${dialogHead(moving?'归入阶段':'归入已有任务')}<form id="project-assignment-form"><label class="project-field" for="project-assign-stage">归入阶段<select id="project-assign-stage" name="stageId">${stageOptions(d.stageId||'')}</select></label>${moving?`<p class="project-help">已选择 ${d.ids.length} 项任务；日期、提醒与完成状态保持不变。</p>`:`<label class="project-field" for="project-assign-query">查找任务<input id="project-assign-query" type="search" value="${esc(d.query||'')}" placeholder="搜索任务或原项目"></label><div class="project-assign-list">${available.length?available.map(t=>`<label class="project-assign-option"><input type="checkbox" data-project-assign-select="${esc(t.id)}" ${d.ids.includes(t.id)?'checked':''}><span><strong>${esc(t.title)}</strong><small>${t.status==='done'?'已完成 · ':''}${t.plannedDate?dateRange(t.plannedDate,taskEnd(t)):'未安排'} · ${esc(project(t.projectId)?.title||'未归项目')}</small></span></label>`).join(''):'<p class="project-help">没有可归入的任务。</p>'}</div><p class="project-help">已选择 ${d.ids.length} 项。任务原地归入；日期、提醒与完成状态保持不变。</p>`}${dialogError()}${dialogFooter('归入项目'+(moving?'阶段':''))}</form>`;
  }else if(d.kind==='schedule'){
   const item=stage(d.id),p=d.preview,affected=p?.tasks||[];
   body=`${dialogHead('调整阶段日期')}<p class="project-dialog-context">${esc(item?.title||'阶段')}</p><form id="project-schedule-form"><div class="project-date-fields"><label class="project-field" for="project-schedule-start">开始日<input id="project-schedule-start" type="date" name="startDate" value="${esc(d.startDate||'')}"></label><label class="project-field" for="project-schedule-end">结束日<input id="project-schedule-end" type="date" name="endDate" value="${esc(d.endDate||'')}"></label></div><button type="button" class="project-subtle" data-stage-unschedule>清除阶段日期</button><label class="project-shift-choice"><input id="project-shift-tasks" type="checkbox" ${d.shiftTasks?'checked':''} ${!item?.startDate||!d.startDate?'disabled':''}><span>同时平移该阶段未完成任务<small>只移动已有安排日期的未完成任务</small></span></label><div class="project-schedule-preview" aria-live="polite">${p?`<p>${dateRange(p.before.startDate,p.before.endDate)} <span aria-hidden="true">→</span> ${dateRange(p.startDate,p.endDate)}</p><p>${d.shiftTasks?`将移动 ${affected.length} 项任务，其中 ${affected.filter(t=>t.reminderAt).length} 项有提醒`:'只调整阶段时间，任务日期保持不变'}</p>${affected.length?`<ol>${affected.map(t=>`<li><strong>${esc(t.title)}</strong><span>${dateRange(t.from,t.fromEnd||t.from)} → ${dateRange(t.to,t.toEnd||t.to)}</span>${t.reminderAt?`<small>提醒保持：${esc(new Date(t.reminderAt).toLocaleString('zh-CN',{hour12:false}))}</small>`:''}${losesFocus(t.focusDate,t.to,t.toEnd)?'<small>将清除原重点</small>':''}</li>`).join('')}</ol>`:''}`:'<p>选择日期后查看改期预览。</p>'}</div><p class="project-help">提醒时间不会自动移动。已完成与未安排的任务保持原状。</p><button type="button" class="project-subtle" data-project-refresh-preview>刷新改期预览</button>${dialogError()}${dialogFooter(p?'确认调整':'查看改期预览')}</form>`;
  }
  return `<dialog id="project-dialog" class="project-dialog" data-kind="${esc(d.kind)}" aria-labelledby="project-dialog-title">${body}</dialog>`;
 }
 function draw(){
  if(!context)return;
  captureSession();cleanupGantt();cleanupGantt=()=>{};
  const container=context.container,active=document.activeElement,focused=container.contains(active),focusId=focused?active.id:'',focusAttribute=focused?['data-project-select','data-project-assign-select','data-stage-toggle','data-project-tab','data-project-group'].find(name=>active.hasAttribute(name)):null,position=focusId&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
  const oldDialog=container.querySelector('#project-dialog'),dialogScroll=oldDialog?.scrollTop||0,assignScroll=container.querySelector('.project-assign-list')?.scrollTop||0,keepDialogScroll=oldDialog?.dataset.kind===model.dialog?.kind;
  if(model.id&&!project()){model.id=null;model.dialog=null;model.selection=[];}
  container.classList.add('project-view');container.dataset.projectMode=model.id?'project':'list';container.dataset.projectId=model.id||'';container.dataset.projectTab=model.id?session().tab:'tasks';
  container.innerHTML=(model.id?renderProject(project()):renderList())+renderDialog();
  const scroller=container.querySelector('.project-scroll');if(scroller)scroller.scrollTop=model.id?(session().scroll||0):model.listScroll;
  if(model.id&&session().tab==='gantt'){
   const gantt=window.ProjectGantt,host=container.querySelector('.project-gantt-host');
   if(gantt)cleanupGantt=gantt.render({container:host,toolbarContainer:container.querySelector('.project-gantt-controls'),project:project(),stages:projectStages(),tasks:projectTasks(),session:session().gantt||(session().gantt={}),onTask:id=>context.openTask(typeof id==='string'?id:id.id),onStage:id=>openEditor('stage',typeof id==='string'?id:id.id),onSchedule:openSchedule,onTaskSchedule:saveTaskRange,onSessionChange:persist})||(()=>{});
   else host.innerHTML='<p class="project-help">甘特图暂时不可用，可通过阶段日期继续安排。</p>';
  }
  const dialog=container.querySelector('#project-dialog');if(dialog){dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy)closeDialog();},{signal:listeners?.signal});}
  if(focusId||focusAttribute){const target=container.querySelector(focusId?'#'+CSS.escape(focusId):`[${focusAttribute}="${CSS.escape(active.getAttribute(focusAttribute))}"]`);target?.focus({preventScroll:true});if(position&&target?.setSelectionRange&&['text','search','textarea'].includes(target.type))target.setSelectionRange(...position);}
  if(dialog&&keepDialogScroll){dialog.scrollTop=dialogScroll;const list=container.querySelector('.project-assign-list');if(list)list.scrollTop=assignScroll;}
  persist();
 }
 function openEditor(kind,id=null){model.dialog={kind,id};draft(kind,id);draw();focus('project-title');}
 function closeDialog(){previewTicket++;model.dialog=null;draw();}
 function confirmAction(title,message,action,label='确认',danger=false){model.dialog={kind:'confirm',title,message,action,label,danger,returnTo:model.dialog};draw();}
 function report(error){const message=error?.message||String(error);const target=context.container.querySelector('.project-dialog-error')||context.container.querySelector('.project-error');if(target)target.textContent=message;else context.toast(message);}
 async function act(fn){if(busy)return;busy=true;context.container.setAttribute('aria-busy','true');context.container.querySelectorAll('[data-project-dialog-save],[data-project-add-task],[data-project-confirm]').forEach(x=>x.disabled=true);try{await fn();}catch(error){report(error);}finally{busy=false;context.container.removeAttribute('aria-busy');context.container.querySelectorAll('[data-project-dialog-save],[data-project-add-task],[data-project-confirm]').forEach(x=>x.disabled=false);}}
 async function refresh(){persist();await context.refresh();}
 async function addTask(reopen=false){
  const p=project(),s=session(),title=(s.quick||'').trim();if(!title)throw Error('先写下任务标题');if([...title].length>200)throw Error('任务标题最多 200 字');
  if(p.status==='completed'&&!reopen){confirmAction('重新打开项目并继续','添加待办会将这个已完成的项目恢复为进行中。取消后项目和任务都保持不变。',{kind:'addTask'},'重新打开并添加');return;}
  const saved=s.quick;await context.api('add',{title,plannedDate:null,projectId:p.id,stageId:s.stageId||null,...(reopen?{reopenProject:true}:{})});if(s.quick===saved)s.quick='';model.dialog=null;await refresh();focus('project-task-title');
 }
 async function saveEditor(){
  const d=model.dialog,v=draft(d.kind,d.id),title=v.title.trim();if(!title||[...title].length>200)throw Error('名称需要 1–200 个字符');
  const patch={title,outcome:v.outcome};
  if(d.kind==='project')patch.targetDate=v.targetDate||null;
  else if(!d.id){if(Boolean(v.startDate)!==Boolean(v.endDate)||v.startDate>v.endDate)throw Error('请一起填写开始日和结束日，且结束日不早于开始日');Object.assign(patch,{projectId:model.id,startDate:v.startDate||null,endDate:v.endDate||null});}
  const result=await context.api(d.kind==='project'?(d.id?'updateProject':'addProject'):(d.id?'updateStage':'addStage'),d.id?{id:d.id,patch}:patch);
  delete model.drafts[`${d.kind}:${d.id||'new'}`];model.dialog=null;
  if(d.kind==='project'&&!d.id){model.id=typeof result==='string'?result:result.id;model.selection=[];session();}
  if(d.kind==='stage'&&!d.id)session().stageId=typeof result==='string'?result:result.id;
  await refresh();if(!d.id&&d.kind==='project')focus('project-task-title');context.toast(d.kind==='project'?'项目已保存':'阶段已保存');
 }
 async function assignTasks(reopen=false,assignment=model.dialog){
  if(!assignment.ids.length)throw Error('先选择要归入的任务');
  if(project().status==='completed'&&!reopen&&assignment.ids.some(id=>tasks().find(t=>t.id===id)?.status==='todo')){confirmAction('重新打开项目并继续','归入待办会将这个已完成的项目恢复为进行中。',{kind:'assign',assignment},'重新打开并归入');return;}
  await context.api('assignTasks',{ids:assignment.ids,projectId:model.id,stageId:assignment.stageId||null,...(reopen?{reopenProject:true}:{})});model.dialog=null;model.selection=[];await refresh();context.toast('任务已归入，日期和提醒保持不变');
 }
 function openSchedule(proposal){
  const item=stage(proposal.id);if(!item)return;
  model.dialog={kind:'schedule',id:item.id,startDate:proposal.startDate===undefined?item.startDate:proposal.startDate,endDate:proposal.endDate===undefined?item.endDate:proposal.endDate,shiftTasks:false,preview:null};draw();void loadPreview();
 }
 async function loadPreview(){
  const d=model.dialog;if(d?.kind!=='schedule')return;const ticket=++previewTicket;
  d.preview=null;persist();
  try{const result=await context.api('previewStageSchedule',{id:d.id,startDate:d.startDate||null,endDate:d.endDate||null,shiftTasks:!!d.shiftTasks});if(model.dialog===d&&ticket===previewTicket){d.preview=result;draw();}}
  catch(error){if(model.dialog===d&&ticket===previewTicket){draw();report(error);}}
 }
 async function saveSchedule(){
  const d=model.dialog;if(!d.preview){await loadPreview();return;}
  let undo;
  try{undo=await context.api('applyStageSchedule',d.preview);}
  catch(error){if(model.dialog===d){d.preview=null;draw();}throw error;}
  model.dialog=null;await refresh();context.toast('阶段日期已调整',async()=>{try{const result=await context.api('undoStageSchedule',undo);await refresh();context.toast(result?.focusSkipped?.length?'已恢复日期；当前重点名额保持不变':'已撤销阶段改期');}catch(error){context.toast(error.message);}});
 }
 async function saveTaskRange(proposal){
  if(busy)throw Error('正在保存，请稍后重试');
  const before=tasks().find(t=>t.id===proposal.id);if(!before)throw Error('任务已不存在，请刷新项目');
  busy=true;
  try{
   const undo=await context.api('scheduleTaskRange',proposal);
   const notes=[];
   if(before.reminderAt)notes.push('提醒不变');
   if(losesFocus(before.focusDate,proposal.startDate,proposal.endDate))notes.push('已清除原重点');
   if(outsideStage({...before,plannedDate:proposal.startDate,plannedEndDate:proposal.endDate},stage(before.stageId)))notes.push('超出阶段范围');
   await refresh();
   context.toast(['任务日期已调整',...notes].join('；'),async()=>{try{const result=await context.api('undoTaskRange',undo);await refresh();context.toast(result?.focusSkipped?.length?'已恢复日期；当前重点名额保持不变':'已撤销任务改期');}catch(error){context.toast(error.message);}});
  }finally{busy=false;}
 }
 async function runConfirmation(){
  const d=model.dialog,a=d.action;
  if(a.kind==='addTask')return addTask(true);
  if(a.kind==='assign')return assignTasks(true,a.assignment);
  if(a.kind==='deleteProject'){await context.api('deleteProject',{id:a.id});delete model.projects[a.id];delete model.drafts[`project:${a.id}`];model.id=null;model.selection=[];}
  else if(a.kind==='deleteStage'){await context.api('deleteStage',{id:a.id});delete model.drafts[`stage:${a.id}`];}
  else if(a.kind==='archive')await context.api('updateProject',{id:a.id,patch:{archivedAt:a.archivedAt}});
  else if(a.kind==='complete')await context.api('updateProject',{id:a.id,patch:{status:'completed'}});
  else if(a.kind==='reopen')await context.api('updateProject',{id:a.id,patch:{status:'active'}});
  else if(a.kind==='detach'){await context.api('assignTasks',{ids:a.ids,projectId:null,stageId:null});model.selection=[];}
  model.dialog=null;await refresh();context.toast(a.kind==='deleteProject'?'项目已删除，任务已保留':a.kind==='deleteStage'?'阶段已删除，任务已移到未分阶段':a.kind==='detach'?'已移出项目，任务已保留':'项目已更新');
 }
 function click(e){
  const b=e.target.closest('button');if(!b||!context.container.contains(b)||b.closest('.project-gantt-host')||busy)return;const data=b.dataset;
  if('projectNew'in data)openEditor('project');
  else if('projectOpen'in data){model.id=data.projectOpen;model.selection=[];model.dialog=null;draw();}
  else if('projectBack'in data){model.id=null;model.selection=[];draw();}
  else if('projectEdit'in data)openEditor('project',data.projectEdit);
  else if('projectGroup'in data){model.groups[data.projectGroup]=!model.groups[data.projectGroup];draw();}
  else if('projectClearSearch'in data){model.query='';draw();focus('project-search');}
  else if('projectTab'in data){session().tab=data.projectTab;draw();}
  else if('projectEnlarge'in data)void act(()=>context.api('maximize'));
  else if('stageNew'in data)openEditor('stage');
  else if('stageEdit'in data)openEditor('stage',data.stageEdit);
  else if('stageToggle'in data){const s=session();s.collapsed||(s.collapsed={});s.collapsed[data.stageToggle]=!s.collapsed[data.stageToggle];draw();}
  else if('stageAddTask'in data){session().stageId=data.stageAddTask;draw();focus('project-task-title');}
  else if('stageSchedule'in data)openSchedule({id:data.stageSchedule});
  else if('projectDialogClose'in data)closeDialog();
  else if('projectConfirmCancel'in data){model.dialog=model.dialog.returnTo||null;draw();}
  else if('projectConfirm'in data)void act(runConfirmation);
  else if('projectComplete'in data)confirmAction('完成项目','全部任务已经完成。确认结束项目后，仍可查看任务和安排。',{kind:'complete',id:data.projectComplete},'完成项目');
  else if('projectReopen'in data)confirmAction('重新打开项目','项目将恢复为进行中，已有任务与提醒保持不变。',{kind:'reopen',id:model.id},'重新打开');
  else if('projectArchive'in data){const p=project();confirmAction(p.archivedAt?'恢复项目':'归档项目',p.archivedAt?'项目将回到项目列表；不会重新触发历史提醒。':'归档只从进行中列表收起项目。任务仍在今天、收集箱和安排中，原日期与提醒继续保留。',{kind:'archive',id:p.id,archivedAt:p.archivedAt?null:new Date().toISOString()},p.archivedAt?'恢复项目':'归档');}
  else if('projectDelete'in data){const p=project();confirmAction('删除项目',`将删除「${p.title}」及 ${projectStages().length} 个阶段，解除 ${projectTasks().length} 项任务的项目归属。任务、日期、提醒与完成记录全部保留。`,{kind:'deleteProject',id:p.id},'删除项目，保留任务',true);}
  else if('stageDelete'in data){const s=stage(data.stageDelete);confirmAction('删除阶段',`将删除「${s.title}」。其中 ${tasks().filter(t=>t.stageId===s.id).length} 项任务保留在本项目「未分阶段」，日期与提醒不变。`,{kind:'deleteStage',id:s.id},'删除阶段，保留任务',true);}
  else if('projectAssign'in data){model.dialog={kind:'assign',ids:[],stageId:session().stageId||'',query:''};draw();}
  else if('projectMove'in data){model.dialog={kind:'move',ids:[...model.selection],stageId:session().stageId||''};draw();}
  else if('projectDetach'in data)confirmAction('移出项目',`将 ${model.selection.length} 项任务移出本项目。任务、日期、提醒和完成记录均保留。`,{kind:'detach',ids:[...model.selection]},'移出项目');
  else if('projectSelectionClear'in data){model.selection=[];draw();}
  else if('projectMulti'in data){session().multi=!session().multi;if(!session().multi)model.selection=[];draw();}
  else if('projectFilterClear'in data){Object.assign(session(),{query:'',status:'all',priority:'all'});draw();}
  else if('stageUnschedule'in data){Object.assign(model.dialog,{startDate:null,endDate:null,shiftTasks:false,preview:null});draw();void loadPreview();}
  else if('projectRefreshPreview'in data)void act(loadPreview);
 }
 function input(e){
  const el=e.target,id=el.id;
  if(id==='project-search'){model.query=el.value;draw();}
  else if(id==='project-task-search'){session().query=el.value;draw();}
  else if(id==='project-task-title'){session().quick=el.value;persist();}
  else if(el.closest('#project-editor-form')){draft(model.dialog.kind,model.dialog.id)[el.name]=el.value;persist();}
  else if(id==='project-assign-query'){model.dialog.query=el.value;draw();}
 }
 function change(e){
  const el=e.target,id=el.id;
  if(id==='project-new-stage'){session().stageId=el.value;persist();}
  else if(id==='project-status-filter'||id==='project-priority-filter'){session()[id==='project-status-filter'?'status':'priority']=el.value;draw();}
  else if('projectSelect'in el.dataset){const set=new Set(model.selection);el.checked?set.add(el.dataset.projectSelect):set.delete(el.dataset.projectSelect);model.selection=[...set];draw();}
  else if('projectAssignSelect'in el.dataset){const set=new Set(model.dialog.ids);el.checked?set.add(el.dataset.projectAssignSelect):set.delete(el.dataset.projectAssignSelect);model.dialog.ids=[...set];draw();}
  else if(id==='project-assign-stage'){model.dialog.stageId=el.value;persist();}
  else if(['project-schedule-start','project-schedule-end','project-shift-tasks'].includes(id)){
   const d=model.dialog;if(d?.kind!=='schedule')return;if(id==='project-shift-tasks')d.shiftTasks=el.checked;else d[id.endsWith('start')?'startDate':'endDate']=el.value||null;if(!d.startDate)d.shiftTasks=false;d.preview=null;persist();void loadPreview();
  }
 }
 function submit(e){
  const id=e.target.id;if(!['project-quick-form','project-editor-form','project-assignment-form','project-schedule-form'].includes(id))return;
  e.preventDefault();if(e.isComposing)return;void act(id==='project-quick-form'?()=>addTask():id==='project-editor-form'?saveEditor:id==='project-assignment-form'?()=>assignTasks():saveSchedule);
 }
 function attach(){
  listeners?.abort();listeners=new AbortController();const el=context.container,options={signal:listeners.signal};
  el.addEventListener('click',click,options);el.addEventListener('input',input,options);el.addEventListener('change',change,options);el.addEventListener('submit',submit,options);
  el.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.isComposing||e.keyCode===229))e.preventDefault();},options);
  el.addEventListener('toggle',e=>{if(e.target.classList?.contains('project-outcome')){session().outcomeOpen=e.target.open;persist();}},{...options,capture:true});
  el.addEventListener('scroll',captureSession,{...options,capture:true});
 }
 window.ProjectView={
  render(options){if(context?.container!==options.container)dispose();context=options;attach();draw();},
  dispose,captureSession,restoreSession,
  open(id){captureSession();model.id=id;model.selection=[];model.dialog=null;persist();},
  resetAfterRestore(){dispose();model=empty();persist();},
  focusNew(){if(!context)return;if(model.id){session().tab='tasks';draw();focus('project-task-title');}else openEditor('project');},
  focusSearch(){if(!context)return;if(model.id){session().tab='tasks';draw();focus('project-task-search');}else focus('project-search');}
 };
})();
