'use strict';
const {randomUUID,createHash}=require('node:crypto');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function ensure(condition,message){if(!condition)throw Error(message);}
function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&value<='9999-12-31'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function instant(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&date(value.slice(0,10));}
function object(value,message){ensure(value&&typeof value==='object'&&!Array.isArray(value),message);}
function fields(value,allowed,message){object(value,message);for(const key of Object.keys(value))ensure(allowed.includes(key),message);}
function wording(value,label){ensure(typeof value.title==='string'&&value.title.trim().length>0&&[...value.title].length<=200,`${label}名称需要 1–200 个字符`);ensure(typeof value.outcome==='string'&&[...value.outcome].length<=10000,`${label}成果说明不能超过 10,000 个字符`);ensure(instant(value.createdAt)&&instant(value.updatedAt),`${label}时间格式不正确`);}
function range(startDate,endDate){ensure((startDate===null&&endDate===null)||(date(startDate)&&date(endDate)&&startDate<=endDate),'阶段开始日与结束日需要同时填写，结束日不能早于开始日');}
function projectValid(project){object(project,'项目格式不正确');ensure(uuid(project.id),'项目标识不正确');wording(project,'项目');ensure(project.targetDate===null||date(project.targetDate),'请选择有效的项目目标完成日');ensure(['active','completed'].includes(project.status),'项目状态不正确');ensure(project.archivedAt===null||instant(project.archivedAt),'项目归档时间不正确');}
function stageValid(stage){object(stage,'阶段格式不正确');ensure(uuid(stage.id)&&uuid(stage.projectId),'阶段归属不正确');wording(stage,'阶段');range(stage.startDate,stage.endDate);ensure(Number.isSafeInteger(stage.order)&&stage.order>=0,'阶段顺序不正确');}
function validateOrganization(state){
 ensure(Array.isArray(state.projects)&&Array.isArray(state.stages),'项目与阶段列表格式不正确');const projects=new Map(),stages=new Map();
 for(const p of state.projects){projectValid(p);ensure(!projects.has(p.id),'项目标识重复');projects.set(p.id,p);}
 for(const stage of state.stages){stageValid(stage);ensure(!stages.has(stage.id),'阶段标识重复');ensure(projects.has(stage.projectId),'阶段所属项目不存在');stages.set(stage.id,stage);}
 for(const task of state.tasks){ensure(task.projectId===null||uuid(task.projectId),'任务项目归属不正确');ensure(task.stageId===null||uuid(task.stageId),'任务阶段归属不正确');ensure(task.projectId===null||projects.has(task.projectId),'任务所属项目不存在');ensure(task.stageId===null||(stages.has(task.stageId)&&stages.get(task.stageId).projectId===task.projectId),'任务阶段必须属于同一项目');if(task.projectId&&task.status==='todo')ensure(projects.get(task.projectId).status!=='completed','已完成项目中仍有待办，请先重新打开项目');}
}
function projectAt(state,id){const project=state.projects.find(p=>p.id===id);ensure(project,'项目不存在，请刷新列表');return project;}
function stageAt(state,id){const stage=state.stages.find(p=>p.id===id);ensure(stage,'阶段不存在，请刷新列表');return stage;}
function association(state,task,patch){
 const previous=task.projectId;if(Object.hasOwn(patch,'projectId'))task.projectId=patch.projectId;
 if(Object.hasOwn(patch,'stageId'))task.stageId=patch.stageId;else if(previous!==task.projectId)task.stageId=null;
 ensure(task.projectId===null||uuid(task.projectId),'任务项目归属不正确');ensure(task.stageId===null||uuid(task.stageId),'任务阶段归属不正确');
 if(task.projectId!==null)projectAt(state,task.projectId);
 if(task.stageId!==null)ensure(stageAt(state,task.stageId).projectId===task.projectId,'任务阶段必须属于同一项目');
 if(Object.hasOwn(patch,'reopenProject'))ensure(typeof patch.reopenProject==='boolean','重新打开项目的选择无效');
 if(task.projectId&&task.status==='todo'){const project=projectAt(state,task.projectId);if(project.status==='completed'){ensure(patch.reopenProject===true,'此项目已完成，请确认重新打开项目并继续');project.status='active';project.updatedAt=new Date().toISOString();}}
}
// UTC is used only as an ordinal calendar, never as a local reminder timestamp.
function dayNumber(value){return Date.parse(value+'T00:00:00Z')/86400000;}
function shiftDate(value,days){const ordinal=dayNumber(value)+days;ensure(date(value)&&Number.isSafeInteger(days)&&ordinal>=dayNumber('0001-01-01')&&ordinal<=dayNumber('9999-12-31'),'平移后的日期超出支持范围');return new Date(ordinal*86400000).toISOString().slice(0,10);}
function containsDate(start,end,value){return !!(start&&end&&value&&start<=value&&value<=end);}
// Expected-state checks must distinguish edits even in one clock tick or after a clock rollback.
function taskTimestamp(task){return new Date(Math.max(Date.now(),Date.parse(task.updatedAt)+1)).toISOString();}
function digest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function initializeGuards(store){store._stagePreviews=new Map();store._stageUndos=new Map();store._taskRangeUndos=new Map();store._scheduleEpoch=randomUUID();store._taskVersions=new Map();store._taskFocusVersions=new Map();store._stageVersions=new Map();store._taskScheduleVersions=new Map();store._stageScheduleVersions=new Map();}
function trackRevisions(store,previous,next){
 for(const [field,versions,schedules,keys] of [['tasks',store._taskVersions,store._taskScheduleVersions,['plannedDate','plannedEndDate','projectId','stageId','status']],['stages',store._stageVersions,store._stageScheduleVersions,['startDate','endDate','projectId']]]){
  const old=new Map(previous[field].map(item=>[item.id,item])),now=new Map(next[field].map(item=>[item.id,item]));for(const id of new Set([...old.keys(),...now.keys()])){const a=old.get(id),b=now.get(id);if(field==='tasks'&&(!a||!b||a.focusDate!==b.focusDate))store._taskFocusVersions.set(id,(store._taskFocusVersions.get(id)||0)+1);if(JSON.stringify(a)!==JSON.stringify(b))versions.set(id,(versions.get(id)||0)+1);if(!a||!b||keys.some(key=>a[key]!==b[key]))schedules.set(id,(schedules.get(id)||0)+1);}
 }
}
function remember(map,token,value){map.set(token,value);while(map.size>64)map.delete(map.keys().next().value);}
function previewFingerprint(store,id){const stage=stageAt(store.state,id),project=projectAt(store.state,stage.projectId);return digest({stage,stageVersion:store._stageVersions.get(id)||0,project,tasks:store.state.tasks.filter(t=>t.stageId===id).map(t=>[t,store._taskVersions.get(t.id)||0])});}
const projectMethods={
 addProject(input){return this.mutate(s=>{fields(input,['title','outcome','targetDate','status','archivedAt'],'项目内容格式不正确');const now=new Date().toISOString(),p={id:randomUUID(),title:typeof input.title==='string'?input.title.trim():input.title,outcome:input.outcome===undefined?'':input.outcome,targetDate:input.targetDate??null,status:input.status===undefined?'active':input.status,archivedAt:input.archivedAt??null,createdAt:now,updatedAt:now};projectValid(p);ensure(p.status==='active','项目尚无任务，不能标为完成');s.projects.push(p);return p;});},
 updateProject(id,patch){return this.mutate(s=>{fields(patch,['title','outcome','targetDate','status','archivedAt'],'不支持修改此项目字段');const p=projectAt(s,id);for(const key of Object.keys(patch))p[key]=key==='title'&&typeof patch[key]==='string'?patch[key].trim():patch[key];if(p.status==='completed'){const tasks=s.tasks.filter(t=>t.projectId===id);ensure(tasks.length>0,'项目尚无任务，不能标为完成');ensure(tasks.every(t=>t.status==='done'),'项目仍有待办，请先处理待办或归档项目');}p.updatedAt=new Date().toISOString();return p;});},
 deleteProject(id){return this.mutate(s=>{projectAt(s,id);s.projects=s.projects.filter(p=>p.id!==id);s.stages=s.stages.filter(stage=>stage.projectId!==id);const now=new Date().toISOString();for(const task of s.tasks)if(task.projectId===id){task.projectId=null;task.stageId=null;task.updatedAt=taskTimestamp(task);}});},
 addStage(input){return this.mutate(s=>{fields(input,['projectId','title','outcome','startDate','endDate','order'],'阶段内容格式不正确');projectAt(s,input.projectId);const now=new Date().toISOString(),existing=s.stages.filter(stage=>stage.projectId===input.projectId),stage={id:randomUUID(),projectId:input.projectId,title:typeof input.title==='string'?input.title.trim():input.title,outcome:input.outcome===undefined?'':input.outcome,startDate:input.startDate??null,endDate:input.endDate??null,order:input.order===undefined?(existing.length?Math.max(...existing.map(stage=>stage.order))+1:0):input.order,createdAt:now,updatedAt:now};stageValid(stage);s.stages.push(stage);return stage;});},
 updateStage(id,patch){return this.mutate(s=>{fields(patch,['title','outcome','startDate','endDate','order'],'不支持修改此阶段字段');const stage=stageAt(s,id);for(const key of Object.keys(patch))stage[key]=key==='title'&&typeof patch[key]==='string'?patch[key].trim():patch[key];stage.updatedAt=new Date().toISOString();return stage;});},
 deleteStage(id){return this.mutate(s=>{stageAt(s,id);s.stages=s.stages.filter(stage=>stage.id!==id);for(const task of s.tasks)if(task.stageId===id){task.stageId=null;task.updatedAt=taskTimestamp(task);}});},
 assignTasks(ids,input){return this.mutate(s=>{ensure(Array.isArray(ids)&&ids.length>0,'请选择要归入项目的任务');fields(input,['projectId','stageId','reopenProject'],'任务归属格式不正确');ensure(Object.hasOwn(input,'projectId'),'请选择项目或未归项目');return [...new Set(ids)].map(id=>{const task=this.get(s,id);association(s,task,input);task.updatedAt=taskTimestamp(task);return task;});});},
 previewStageSchedule(input){
  fields(input,['id','startDate','endDate','shiftTasks'],'阶段改期格式不正确');const stage=stageAt(this.state,input.id),{startDate,endDate}=input,shiftTasks=input.shiftTasks===undefined?false:input.shiftTasks;range(startDate,endDate);ensure(typeof shiftTasks==='boolean','请选择是否同时平移任务');if(shiftTasks)ensure(stage.startDate&&startDate,'阶段需要原开始日和新开始日，才能同时平移任务');const deltaDays=stage.startDate&&startDate?dayNumber(startDate)-dayNumber(stage.startDate):0;
  const tasks=shiftTasks&&deltaDays!==0?this.state.tasks.filter(t=>t.stageId===stage.id&&t.status==='todo'&&t.plannedDate).map(t=>({id:t.id,title:t.title,from:t.plannedDate,fromEnd:t.plannedEndDate,to:shiftDate(t.plannedDate,deltaDays),toEnd:shiftDate(t.plannedEndDate,deltaDays),reminderAt:t.reminderAt,focusDate:t.focusDate})):[];
  const preview={id:stage.id,startDate,endDate,shiftTasks,deltaDays,before:{startDate:stage.startDate,endDate:stage.endDate},tasks,token:randomUUID()};remember(this._stagePreviews,preview.token,{preview:structuredClone(preview),fingerprint:previewFingerprint(this,stage.id)});return preview;
 },
 applyStageSchedule(preview){
  object(preview,'改期预览无效，请重新预览');const pending=this._stagePreviews.get(preview.token);ensure(pending&&digest(pending.preview)===digest(preview),'改期预览已失效，请重新预览');ensure(pending.fingerprint===previewFingerprint(this,preview.id),'阶段或任务已有变化，请重新预览后确认');
  const undoToken=randomUUID();this.mutate(s=>{const stage=stageAt(s,preview.id),now=new Date().toISOString();stage.startDate=preview.startDate;stage.endDate=preview.endDate;stage.updatedAt=now;for(const item of preview.tasks){const task=this.get(s,item.id);task.plannedDate=item.to;task.plannedEndDate=item.toEnd;if(!containsDate(item.to,item.toEnd,task.focusDate))task.focusDate=null;task.updatedAt=taskTimestamp(task);}});
  this._stagePreviews.delete(preview.token);remember(this._stageUndos,undoToken,{preview:structuredClone(preview),stageVersion:this._stageScheduleVersions.get(preview.id)||0,taskVersions:preview.tasks.map(item=>[item.id,this._taskScheduleVersions.get(item.id)||0]),focusVersions:preview.tasks.map(item=>[item.id,this._taskFocusVersions.get(item.id)||0])});return {token:undoToken};
 },
 undoStageSchedule(undo){
  fields(undo,['token'],'撤销内容无效');const saved=this._stageUndos.get(undo.token);ensure(saved,'此次改期已无法撤销，请重新安排日期');const {preview}=saved,focusVersions=new Map(saved.focusVersions),stage=stageAt(this.state,preview.id);ensure((this._stageScheduleVersions.get(stage.id)||0)===saved.stageVersion,'阶段日期已有变化，无法撤销本次改期');for(const [id,version] of saved.taskVersions)ensure((this._taskScheduleVersions.get(id)||0)===version,'任务日期或归属已有变化，无法撤销本次改期');
  const result=this.mutate(s=>{const stage=stageAt(s,preview.id),now=new Date().toISOString(),focusSkipped=[];stage.startDate=preview.before.startDate;stage.endDate=preview.before.endDate;stage.updatedAt=now;for(const entry of preview.tasks){const task=this.get(s,entry.id);task.plannedDate=entry.from;task.plannedEndDate=entry.fromEnd;if(!containsDate(entry.from,entry.fromEnd,task.focusDate))task.focusDate=null;task.updatedAt=taskTimestamp(task);}for(const entry of preview.tasks){const task=this.get(s,entry.id);if(!entry.focusDate||task.focusDate||(this._taskFocusVersions.get(entry.id)||0)!==focusVersions.get(entry.id))continue;if(task.status==='done'||s.tasks.filter(t=>t.status==='todo'&&t.focusDate===entry.focusDate).length<3)task.focusDate=entry.focusDate;else focusSkipped.push(task.title);}return {focusSkipped};});this._stageUndos.delete(undo.token);return result;
 }
};
module.exports={validateOrganization,association,projectMethods,initializeGuards,trackRevisions,date,dayNumber,shiftDate,containsDate,remember,taskTimestamp};
