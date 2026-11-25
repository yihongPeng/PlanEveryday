(() => {
 'use strict';
 const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let ctx, assigning=[];
 const get=()=>ctx.getState(), byId=(items,id)=>items?.find(item=>item.id===id);
 const read=key=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}');}catch{return {};}};
 function confirm(title,text,label='继续') {
  const dialog=document.querySelector('#shared-confirm-dialog');
  if(dialog.open)return Promise.resolve(false);
  dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=text;
  dialog.querySelector('#shared-confirm-yes').textContent=label;dialog.returnValue='';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
 }
 function fields(value={}) {
  const state=get(), projectId=value.projectId||'',stageId=value.stageId||'';
  return `<label class="field">所属项目<select name="projectId" aria-label="所属项目"><option value="">未归项目</option>${(state.projects||[]).map(p=>`<option value="${p.id}" ${p.id===projectId?'selected':''}>${esc(p.title)}${p.archivedAt?'（已归档）':p.status==='completed'?'（已完成）':''}</option>`).join('')}</select></label><label class="field">所属阶段<select name="stageId" aria-label="所属阶段" ${projectId?'':'disabled'}>${stageOptions(projectId,stageId)}</select></label>`;
 }
 function stageOptions(projectId,stageId='') {return '<option value="">未分阶段</option>'+(get().stages||[]).filter(s=>s.projectId===projectId).sort((a,b)=>a.order-b.order).map(s=>`<option value="${s.id}" ${s.id===stageId?'selected':''}>${esc(s.title)}</option>`).join('');}
 function bindFields(form,onChange=()=>{}) {
  form.querySelector('[name=projectId]').addEventListener('change',e=>{
   const select=form.querySelector('[name=stageId]');select.innerHTML=stageOptions(e.target.value);select.disabled=!e.target.value;onChange();
  });
  form.querySelector('[name=stageId]').addEventListener('change',onChange);
 }
 async function allowTodo(projectId) {
  const project=byId(get().projects,projectId);
  return !project||project.status!=='completed'||await confirm('重新打开项目并继续？','这项待办需要把项目恢复为进行中，已完成的其他任务保持不变。','重新打开并继续');
 }
 function membership(task) {
  const project=byId(get().projects,task.projectId),stage=byId(get().stages,task.stageId);
  return project?`<button class="task-project-link" data-open-project="${project.id}" title="打开项目：${esc(project.title)}">${esc(project.title)}${stage?' · '+esc(stage.title):''}</button>`:'';
 }
 function inbox(tasks,row,empty) {
  if(!(get().projects||[]).length)return null;
  const groups=[{id:'unassigned',title:'未归项目'},...(get().projects||[])];
  const closed=read('inbox-projects'),filtered=!!ctx.isFiltered();
  return groups.map(p=>{
   const list=tasks.filter(t=>(t.projectId||'unassigned')===p.id);if(!list.length)return '';
   return `<details class="inbox-project-group" data-inbox-group="${p.id}" ${filtered||!closed[p.id]?'open':''}><summary class="group-heading"><span>${esc(p.title)}</span><small>${list.length}</small><span class="line"></span></summary>${list.map(t=>row(t)).join('')}</details>`;
  }).join('')||empty;
 }
 function planningFilter() {
  const state=get(),f=read('plan-project-filter'),validProject=(state.projects||[]).some(p=>p.id===f.projectId);
  if(!validProject&&f.projectId!=='unassigned')return {projectId:'',stageId:''};
  const stageId=validProject&&(f.stageId==='unassigned'||(state.stages||[]).some(s=>s.id===f.stageId&&s.projectId===f.projectId))?f.stageId:'';
  return {projectId:f.projectId,stageId};
 }
 function filtersHTML() {
  const state=get(),f=planningFilter();
  return `<div class="plan-project-filters"><label>待安排项目<select id="plan-project-filter" aria-label="筛选待安排项目"><option value="">全部项目</option><option value="unassigned" ${f.projectId==='unassigned'?'selected':''}>未归项目</option>${(state.projects||[]).map(p=>`<option value="${p.id}" ${f.projectId===p.id?'selected':''}>${esc(p.title)}</option>`).join('')}</select></label><label>阶段<select id="plan-stage-filter" aria-label="筛选待安排阶段" ${!f.projectId||f.projectId==='unassigned'?'disabled':''}><option value="">全部阶段</option><option value="unassigned" ${f.stageId==='unassigned'?'selected':''}>未分阶段</option>${(state.stages||[]).filter(s=>s.projectId===f.projectId).map(s=>`<option value="${s.id}" ${s.id===f.stageId?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label></div>`;
 }
 function filteredTasks(tasks) {
  const f=planningFilter();
  return tasks.filter(t=>!f.projectId||((t.projectId||'unassigned')===f.projectId&&(!f.stageId||(t.stageId||'unassigned')===f.stageId)));
 }
 function warning(form,task) {
  const host=form.querySelector('.task-range-notice');if(!host)return;
  const values=Object.fromEntries(new FormData(form)),stage=byId(get().stages,values.stageId),date=values.plannedDate,end=values.plannedEndDate||date;
  const outside=stage?.startDate&&date&&(date<stage.startDate||end>stage.endDate);
  host.hidden=!outside;
  if(!outside){host.replaceChildren();return;}
  host.innerHTML=`<p>任务跨度超出阶段范围（${esc(stage.startDate)}—${esc(stage.endDate)}）。可以保留此安排，或调整日期。</p><button type="button" class="text-button" data-expand-task-stage>扩展阶段以包含此跨度</button>`;
  host.querySelector('button').onclick=async()=>{
   try{
    if(!await confirm('扩展阶段时间？','只扩展阶段范围，任务日期与提醒均不改变。请另行保存尚未保存的任务修改。','扩展阶段'))return;
    await ctx.api('scheduleStageRange',{id:stage.id,startDate:date<stage.startDate?date:stage.startDate,endDate:end>stage.endDate?end:stage.endDate,expected:{startDate:stage.startDate,endDate:stage.endDate,updatedAt:stage.updatedAt}});
    await ctx.refresh();ctx.openTask(task.id);ctx.toast('阶段范围已扩展');
   }catch(e){ctx.toast(e.message);}
  };
 }
 function openAssignment(ids) {
  assigning=[...new Set(ids)];if(!assigning.length){ctx.toast('先选择要归入项目的任务');return;}
  const task=get().tasks.find(t=>t.id===assigning[0]);
  document.querySelector('#assignment-fields').innerHTML=fields(assigning.length===1?task:{});
  document.querySelector('#assignment-count').textContent=`已选择 ${assigning.length} 项任务`;
  document.querySelector('#assignment-error').textContent='';
  bindFields(document.querySelector('#assignment-form'));document.querySelector('#assignment-dialog').showModal();
 }
 function init(context) {
  ctx=context;
  document.addEventListener('toggle',e=>{
   const id=e.target.dataset?.inboxGroup;if(!id||ctx.isFiltered())return;
   const closed=read('inbox-projects');closed[id]=!e.target.open;sessionStorage.setItem('inbox-projects',JSON.stringify(closed));
  },true);
  document.addEventListener('change',e=>{
   if(!['plan-project-filter','plan-stage-filter'].includes(e.target.id))return;
   const f=read('plan-project-filter');if(e.target.id==='plan-project-filter'){f.projectId=e.target.value;f.stageId='';}else f.stageId=e.target.value;
   sessionStorage.setItem('plan-project-filter',JSON.stringify(f));ctx.renderTasks();
  });
  document.querySelector('[data-close-assignment]').onclick=()=>document.querySelector('#assignment-dialog').close();
  document.querySelector('#assignment-form').onsubmit=async e=>{
   e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;
   try{
    const data=Object.fromEntries(new FormData(form)),projectId=data.projectId||null,stageId=data.stageId||null;
    const hasTodo=get().tasks.some(t=>assigning.includes(t.id)&&t.status==='todo');
    if(hasTodo&&!await allowTodo(projectId))return;
    await ctx.api('assignTasks',{ids:assigning,projectId,stageId,reopenProject:hasTodo});
    ctx.onAssigned(assigning,{projectId,stageId});await ctx.refresh();document.querySelector('#assignment-dialog').close();ctx.toast(`已调整 ${assigning.length} 项任务的归属`);
   }catch(error){document.querySelector('#assignment-error').textContent=error.message;}
   finally{button.disabled=false;}
  };
 }
 window.ProjectLinks={init,fields,bindFields,allowTodo,confirm,membership,inbox,filtersHTML,filteredTasks,warning,openAssignment};
})();
