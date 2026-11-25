'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const {mkdirSync}=require('node:fs');
const {dirname,join}=require('node:path');
const {validateOrganization,association,projectMethods,initializeGuards,trackRevisions,date,dayNumber,shiftDate,containsDate,remember,taskTimestamp}=require('./project-model.cjs');
const clone=value=>structuredClone(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const defaults={petVisible:true,petAlwaysOnTop:true,doNotDisturb:false};
const today=(value=new Date())=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function ensure(condition,message){if(!condition)throw new Error(message);}
function taskRange(start,end){ensure((start===null&&end===null)||(date(start)&&date(end)&&start<=end),'计划开始日与结束日需要同时填写，结束日不能早于开始日');}
function updateDates(task,patch){
 const hasStart=Object.hasOwn(patch,'plannedDate'),hasEnd=Object.hasOwn(patch,'plannedEndDate');if(!hasStart&&!hasEnd)return;
 const start=hasStart?patch.plannedDate:task.plannedDate;
 const end=hasEnd?patch.plannedEndDate:start===null?null:hasStart?(task.plannedDate&&date(start)?shiftDate(task.plannedEndDate,dayNumber(start)-dayNumber(task.plannedDate)):start):task.plannedEndDate;
 taskRange(start,end);task.plannedDate=start;task.plannedEndDate=end;if(!containsDate(start,end,task.focusDate))task.focusDate=null;
}
function instant(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&date(value.slice(0,10));}
function taskValid(t){
 ensure(t&&typeof t==='object'&&uuid(t.id),'任务格式不正确');
 ensure(typeof t.title==='string'&&t.title.trim().length>0&&t.title.length<=200,'标题需要 1–200 个字符');
 ensure(typeof t.notes==='string'&&t.notes.length<=10000,'备注不能超过 10,000 个字符');
 taskRange(t.plannedDate,t.plannedEndDate);
 ensure(['normal','important','urgent'].includes(t.priority),'优先级不正确');
 ensure(['todo','done'].includes(t.status),'任务状态不正确');
 ensure(t.focusDate===null||(date(t.focusDate)&&containsDate(t.plannedDate,t.plannedEndDate,t.focusDate)),'重点日期不在计划日期范围内');
 ensure(instant(t.createdAt)&&instant(t.updatedAt),'任务时间格式不正确');
 ensure(t.status==='done'?instant(t.completedAt):t.completedAt===null,'完成时间不正确');
 ensure(t.reminderAt===null||instant(t.reminderAt),'提醒时间格式不正确');
 ensure(Number.isSafeInteger(t.reminderRevision)&&t.reminderRevision>=0&&Number.isSafeInteger(t.remindedRevision)&&t.remindedRevision>=0&&t.remindedRevision<=t.reminderRevision,'提醒版本不正确');
 ensure(t.reminderAt===null||t.reminderRevision>0,'提醒版本不正确');
}
function normalizeTags(tags){
 ensure(Array.isArray(tags),'标签需要是列表');const result=[],seen=new Set();
 for(const value of tags){ensure(typeof value==='string','标签必须是文字');const tag=value.trim();if(!tag)continue;ensure([...tag].length<=24&&!/[\r\n,，]/.test(tag),'每个标签最多 24 字，不能包含逗号或换行');const key=tag.toLocaleLowerCase();if(!seen.has(key)){seen.add(key);result.push(tag);}}
 ensure(result.length<=12,'每篇最多添加 12 个标签');return result;
}
function knowledgeValid(k){
 ensure(k&&typeof k==='object'&&!Array.isArray(k)&&uuid(k.id),'记背条目格式不正确');
 ensure(typeof k.title==='string'&&k.title.trim().length>0&&[...k.title].length<=200,'记背标题需要 1–200 个字符');
 ensure(typeof k.content==='string'&&[...k.content].length<=50000,'记背正文不能超过 50,000 个字符');
 ensure(typeof k.pinned==='boolean','置顶状态不正确');
 ensure(!Object.hasOwn(k,'toc')||typeof k.toc==='boolean','目录开关格式不正确');
 ensure(JSON.stringify(normalizeTags(k.tags))===JSON.stringify(k.tags),'标签格式不正确或重复');
 ensure(instant(k.createdAt)&&instant(k.updatedAt),'记背时间格式不正确');
}
function settingsValid(settings){
 ensure(settings&&typeof settings==='object'&&!Array.isArray(settings),'设置格式不正确');
 for(const [key,value] of Object.entries(settings)){
  if(['petVisible','petAlwaysOnTop','doNotDisturb','closeHintSeen'].includes(key))ensure(typeof value==='boolean','设置开关格式不正确');
  else if(['windowBounds','petPosition'].includes(key)){ensure(value&&typeof value==='object','窗口位置格式不正确');for(const field of key==='windowBounds'?['x','y','width','height']:['x','y'])ensure(Number.isFinite(value[field]),'窗口位置格式不正确');if(key==='windowBounds')ensure(value.width>0&&value.height>0,'窗口大小不正确');}
  else ensure(false,'未知设置字段');
 }
}
function stateValid(state){
 ensure(state&&Array.isArray(state.tasks)&&Array.isArray(state.events)&&Array.isArray(state.knowledge),'备份内容格式不正确');
 validateOrganization(state);
 const knowledgeIds=new Set();for(const k of state.knowledge){knowledgeValid(k);ensure(!knowledgeIds.has(k.id),'备份包含重复记背条目');knowledgeIds.add(k.id);}
 const ids=new Set(),focus=new Map();for(const t of state.tasks){taskValid(t);ensure(!ids.has(t.id),'备份包含重复任务');ids.add(t.id);if(t.status==='todo'&&t.focusDate){focus.set(t.focusDate,(focus.get(t.focusDate)||0)+1);ensure(focus.get(t.focusDate)<=3,'每天最多选择 3 项重点');}}
 const events=new Set();for(const e of state.events){ensure(e&&uuid(e.id)&&!events.has(e.id),'提醒记录重复或无效');events.add(e.id);ensure(uuid(e.taskId)&&ids.has(e.taskId)&&typeof e.title==='string'&&e.title.length<=200&&instant(e.createdAt)&&(e.readAt===null||instant(e.readAt)),'提醒记录格式不正确');}
 settingsValid(state.settings);
}
function validateBackup(input){
 ensure(input&&[1,2,3,4,5,6].includes(input.schemaVersion),'不支持此备份版本');
 const backup=clone(input);if(backup.schemaVersion===1)backup.knowledge=[];if(backup.schemaVersion<3&&Array.isArray(backup.knowledge))for(const k of backup.knowledge)if(k&&!Object.hasOwn(k,'tags'))k.tags=[];
 if(backup.schemaVersion<5){backup.projects=[];backup.stages=[];if(Array.isArray(backup.tasks))for(const task of backup.tasks){if(task&&typeof task==='object'){task.projectId=null;task.stageId=null;}}}
 if(backup.schemaVersion<6&&Array.isArray(backup.tasks))for(const task of backup.tasks)if(task&&typeof task==='object')task.plannedEndDate=task.plannedDate;
 stateValid(backup);require('./media.cjs').validateAttachments(backup);return backup;
}
function normalizeStateSnapshot(input,version=0){
 ensure(Number.isInteger(version)&&version>=0&&version<=3,'数据来自更高版本，请使用新版程序打开');const state=clone(input);ensure(state&&typeof state==='object'&&!Array.isArray(state),'数据格式不正确');
 if(!Object.hasOwn(state,'knowledge'))state.knowledge=[];
 if(Array.isArray(state.knowledge))for(const k of state.knowledge)if(k&&!Object.hasOwn(k,'tags'))k.tags=[];
 if(version<2&&!Object.hasOwn(state,'projects')&&!Object.hasOwn(state,'stages')){state.projects=[];state.stages=[];}
 if(version<2&&Array.isArray(state.tasks))for(const task of state.tasks)if(task&&typeof task==='object'){if(!Object.hasOwn(task,'projectId'))task.projectId=null;if(!Object.hasOwn(task,'stageId'))task.stageId=null;}
 if(version<3&&Array.isArray(state.tasks))for(const task of state.tasks)if(task&&typeof task==='object')task.plannedEndDate=task.plannedDate;
 stateValid(state);return state;
}
function stateBackup(state){const {tasks,events,knowledge,projects,stages,settings}=clone(state);const portable={};for(const key of Object.keys(defaults))portable[key]=settings[key]??defaults[key];return {schemaVersion:6,exportedAt:new Date().toISOString(),tasks,events,knowledge,projects,stages,settings:portable,attachments:[]};}
class Store{
 constructor(dbPath){
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  this.db=new DatabaseSync(dbPath);
  try {
  const version=this.db.prepare('PRAGMA user_version').get().user_version;ensure(version<=3,'数据来自更高版本，请使用新版程序打开');
  const table=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='planner_state'").get();
  const row=table?this.db.prepare('SELECT data FROM planner_state WHERE id=1').get():null;
  this.state=row?normalizeStateSnapshot(JSON.parse(row.data),version):{tasks:[],events:[],knowledge:[],projects:[],stages:[],settings:clone(defaults)};initializeGuards(this);
  if(row&&version<3&&dbPath!==':memory:'){
   const {Media,saveBackup}=require('./media.cjs');const directory=dirname(dbPath),complete=new Media(directory).export(stateBackup(this.state));
   saveBackup(join(directory,'backups',`before-schema-3-${Date.now()}-${randomUUID()}.json`),complete);
  }
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
  if(!row||version<3||JSON.stringify(this.state)!==row.data)this.mutate(()=>{},{initialize:true});
  } catch(error){this.db.close();throw error;}
 }
 summary(){return {settings:clone(this.state.settings),unread:this.state.events.filter(e=>!e.readAt).length,done:this.state.tasks.filter(t=>t.status==='done'&&t.completedAt&&today(t.completedAt)===today()).length};}
 snapshot(){return clone(this.state);}
 mutate(fn,{initialize=false}={}){
  const next=clone(this.state);const result=fn(next);stateValid(next);
  try{this.db.exec('BEGIN IMMEDIATE');if(initialize)this.db.exec('CREATE TABLE IF NOT EXISTS planner_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');this.db.prepare('INSERT INTO planner_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(next));if(initialize)this.db.exec('PRAGMA user_version=3');this.db.exec('COMMIT');}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw new Error('保存失败，请检查磁盘空间和数据目录权限后重试。',{cause:error});}
  trackRevisions(this,this.state,next);this.state=next;return clone(result);
 }
 addKnowledge(input){return this.mutate(s=>{ensure(input&&typeof input==='object','记背内容格式不正确');const now=new Date().toISOString();const k={id:randomUUID(),title:typeof input.title==='string'?input.title.trim():input.title,content:input.content===undefined?'':input.content,pinned:input.pinned===undefined?false:input.pinned,toc:input.toc===undefined?false:input.toc,tags:normalizeTags(input.tags===undefined?[]:input.tags),createdAt:now,updatedAt:now};knowledgeValid(k);s.knowledge.push(k);return k;});}
 updateKnowledge(id,patch){return this.mutate(s=>{const k=s.knowledge.find(k=>k.id===id);ensure(k,'记背条目不存在，请刷新列表');ensure(patch&&typeof patch==='object'&&!Array.isArray(patch),'记背修改格式不正确');for(const key of Object.keys(patch)){ensure(['title','content','pinned','tags','toc'].includes(key),'不支持修改此记背字段');k[key]=key==='tags'?normalizeTags(patch[key]):key==='title'&&typeof patch[key]==='string'?patch[key].trim():patch[key];}k.updatedAt=new Date().toISOString();return k;});}
 deleteKnowledge(id){return this.mutate(s=>{ensure(s.knowledge.some(k=>k.id===id),'记背条目不存在，请刷新列表');s.knowledge=s.knowledge.filter(k=>k.id!==id);});}
 get(state,id){const t=state.tasks.find(t=>t.id===id);ensure(t,'任务不存在，请刷新列表');return t;}
 addTask(input){return this.mutate(s=>{ensure(input&&typeof input==='object'&&!Array.isArray(input),'任务内容格式不正确');const now=new Date().toISOString();const t={id:randomUUID(),title:typeof input.title==='string'?input.title.trim():input.title,notes:input.notes??'',plannedDate:input.plannedDate??null,plannedEndDate:input.plannedEndDate===undefined?(input.plannedDate??null):input.plannedEndDate,priority:input.priority??'normal',status:'todo',focusDate:null,projectId:null,stageId:null,createdAt:now,updatedAt:now,completedAt:null,reminderAt:null,reminderRevision:0,remindedRevision:0};association(s,t,input);if(input.reminderAt!==undefined&&input.reminderAt!==null)this.reminder(t,input.reminderAt);taskValid(t);s.tasks.push(t);return t;});}
 reminder(t,value){ensure(value===null||(instant(value)&&Date.parse(value)>Date.now()),'提醒时间必须晚于现在，请重新选择');t.reminderAt=value===null?null:new Date(value).toISOString();t.reminderRevision++;}
 updateTask(id,patch){return this.mutate(s=>{const t=this.get(s,id);ensure(patch&&typeof patch==='object'&&!Array.isArray(patch),'任务修改格式不正确');for(const key of Object.keys(patch))ensure(['title','notes','plannedDate','plannedEndDate','priority','status','reminderAt','projectId','stageId','reopenProject'].includes(key),'不支持修改此任务字段');if(Object.hasOwn(patch,'title'))t.title=typeof patch.title==='string'?patch.title.trim():patch.title;if(Object.hasOwn(patch,'notes'))t.notes=patch.notes;updateDates(t,patch);if(Object.hasOwn(patch,'priority'))t.priority=patch.priority;if(Object.hasOwn(patch,'reminderAt')&&patch.reminderAt!==t.reminderAt)this.reminder(t,patch.reminderAt);if(Object.hasOwn(patch,'status')&&patch.status!==t.status){t.status=patch.status;t.completedAt=t.status==='done'?new Date().toISOString():null;if(t.status==='done')t.remindedRevision=t.reminderRevision;else if(t.status==='todo'&&t.focusDate&&s.tasks.filter(a=>a.id!==t.id&&a.status==='todo'&&a.focusDate===t.focusDate).length>=3)t.focusDate=null;}association(s,t,patch);t.updatedAt=taskTimestamp(t);return t;});}
 deleteTask(id){return this.mutate(s=>{this.get(s,id);s.tasks=s.tasks.filter(t=>t.id!==id);s.events=s.events.filter(e=>e.taskId!==id);});}
 setSettings(patch){return this.mutate(s=>{s.settings={...s.settings,...patch};return s.settings;});}
 scheduleTasks(ids,value){
  const entries=this.mutate(s=>{ensure(Array.isArray(ids),'请选择要安排的任务');ensure(value===null||date(value),'请选择有效的计划日期');return [...new Set(ids)].map(id=>{const t=this.get(s,id),old={id,plannedDate:t.plannedDate,plannedEndDate:t.plannedEndDate,focusDate:t.focusDate};if(t.plannedDate!==value){updateDates(t,{plannedDate:value});t.updatedAt=taskTimestamp(t);}return old;});});
  return entries.map(entry=>({...entry,scheduleVersion:this._taskScheduleVersions.get(entry.id)||0,scheduleEpoch:this._scheduleEpoch,focusVersion:this._taskFocusVersions.get(entry.id)||0}));
 }
 scheduleTaskRange(input){
  ensure(input&&typeof input==='object'&&!Array.isArray(input),'任务改期格式不正确');for(const key of Object.keys(input))ensure(['id','startDate','endDate','expected'].includes(key),'任务改期格式不正确');
  const {id,startDate,endDate,expected}=input;taskRange(startDate,endDate);const current=this.get(this.state,id);
  ensure(expected&&typeof expected==='object'&&!Array.isArray(expected)&&Object.hasOwn(expected,'plannedDate')&&Object.hasOwn(expected,'updatedAt'),'请刷新任务后重新安排日期');
  ensure(current.plannedDate===expected.plannedDate&&current.plannedEndDate===(expected.plannedEndDate??expected.plannedDate)&&current.updatedAt===expected.updatedAt,'任务已有变化，请刷新后重新安排日期');
  const entry=this.mutate(s=>{const task=this.get(s,id),before={id,plannedDate:task.plannedDate,plannedEndDate:task.plannedEndDate,focusDate:task.focusDate};updateDates(task,{plannedDate:startDate,plannedEndDate:endDate});task.updatedAt=taskTimestamp(task);return before;});
  const token=randomUUID();remember(this._taskRangeUndos,token,[{...entry,scheduleVersion:this._taskScheduleVersions.get(id)||0,scheduleEpoch:this._scheduleEpoch,focusVersion:this._taskFocusVersions.get(entry.id)||0}]);return {token};
 }
 undoTaskRange(undo){
  ensure(undo&&typeof undo==='object'&&!Array.isArray(undo)&&Object.keys(undo).length===1&&typeof undo.token==='string','撤销内容无效');
  const entries=this._taskRangeUndos.get(undo.token);ensure(entries,'此次改期已无法撤销，请重新安排日期');const result=this.undoSchedule(entries);this._taskRangeUndos.delete(undo.token);return result;
 }
 undoSchedule(entries){return this.mutate(s=>{
  ensure(Array.isArray(entries),'撤销内容无效');
  const focusSkipped=[];
  // Restore all dates first so existing focus slots remain ahead of restored slots.
  for(const entry of entries){
   ensure(entry&&typeof entry==='object','撤销内容无效');const end=Object.hasOwn(entry,'plannedEndDate')?entry.plannedEndDate:entry.plannedDate;taskRange(entry.plannedDate,end);
   ensure(entry.focusDate===null||(date(entry.focusDate)&&containsDate(entry.plannedDate,end,entry.focusDate)),'撤销重点日期无效');
   if(Object.hasOwn(entry,'scheduleVersion'))ensure(entry.scheduleEpoch===this._scheduleEpoch&&(this._taskScheduleVersions.get(entry.id)||0)===entry.scheduleVersion,'任务日期、状态或归属已有变化，无法撤销本次改期');
   const t=this.get(s,entry.id);t.plannedDate=entry.plannedDate;t.plannedEndDate=end;
   if(!containsDate(t.plannedDate,t.plannedEndDate,t.focusDate))t.focusDate=null;
   t.updatedAt=taskTimestamp(t);
  }
  for(const entry of entries){
   const t=this.get(s,entry.id);
   if(!entry.focusDate||t.focusDate||(Object.hasOwn(entry,'focusVersion')&&(this._taskFocusVersions.get(entry.id)||0)!==entry.focusVersion))continue;
   const count=s.tasks.filter(a=>a.status==='todo'&&a.focusDate===entry.focusDate).length;
   if(t.status==='done'||count<3)t.focusDate=entry.focusDate;
   else focusSkipped.push(t.title);
  }
  return {focusSkipped};
 });}
 toggleFocus(id,replaceId){return this.mutate(s=>{const t=this.get(s,id),day=today();ensure(t.status==='todo'&&containsDate(t.plannedDate,t.plannedEndDate,day),'请先将待办任务安排到今天');if(t.focusDate===day)t.focusDate=null;else{const focused=s.tasks.filter(a=>a.status==='todo'&&a.focusDate===day);if(focused.length>=3){const old=focused.find(a=>a.id===replaceId);ensure(old,'今天最多选择 3 项重点，请先选择要替换的一项');old.focusDate=null;old.updatedAt=taskTimestamp(old);}t.focusDate=day;}t.updatedAt=taskTimestamp(t);return t;});}
 consume(s,now){const added=[];for(const t of s.tasks){if(t.status==='todo'&&t.reminderAt&&Date.parse(t.reminderAt)<=now&&t.remindedRevision<t.reminderRevision){const event={id:randomUUID(),taskId:t.id,title:t.title,createdAt:new Date(now).toISOString(),readAt:null};if(!s.events.some(e=>e.id===event.id)){s.events.push(event);added.push(event);}t.remindedRevision=t.reminderRevision;}}return added;}
 pollReminders(now=Date.now(),{silent=false}={}){ensure(Number.isFinite(now),'提醒检查时间无效');if(!this.state.tasks.some(t=>t.status==='todo'&&t.reminderAt&&Date.parse(t.reminderAt)<=now&&t.remindedRevision<t.reminderRevision))return [];return this.mutate(s=>this.consume(s,now));}
 markRead(ids=null){if(ids!==null)ensure(Array.isArray(ids)&&ids.every(uuid),'提醒标识无效');return this.mutate(s=>{const now=new Date().toISOString();for(const e of s.events)if(!e.readAt&&(ids===null||ids.includes(e.id)))e.readAt=now;});}
 exportBackup(){return stateBackup(this.state);}
 restoreBackup(input){const backup=validateBackup(input);const result=this.mutate(s=>{s.tasks=backup.tasks;s.events=backup.events;s.knowledge=backup.knowledge;s.projects=backup.projects;s.stages=backup.stages;for(const key of Object.keys(defaults))s.settings[key]=backup.settings[key]??defaults[key];this.consume(s,Date.now());});this._stageUndos.clear();this._taskRangeUndos.clear();this._scheduleEpoch=randomUUID();return result;}
 close(){this.db.close();}
}
Object.assign(Store.prototype,projectMethods);
module.exports={Store,today,validateBackup,normalizeStateSnapshot,stateBackup};
