'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const {mkdirSync}=require('node:fs');
const {dirname}=require('node:path');
const clone=value=>structuredClone(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const defaults={petVisible:true,petAlwaysOnTop:true,doNotDisturb:false};
const today=(value=new Date())=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function ensure(condition,message){if(!condition)throw new Error(message);}
function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function instant(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&date(value.slice(0,10));}
function taskValid(t){
 ensure(t&&typeof t==='object'&&uuid(t.id),'任务格式不正确');
 ensure(typeof t.title==='string'&&t.title.trim().length>0&&t.title.length<=200,'标题需要 1–200 个字符');
 ensure(typeof t.notes==='string'&&t.notes.length<=10000,'备注不能超过 10,000 个字符');
 ensure(t.plannedDate===null||date(t.plannedDate),'请选择有效的计划日期');
 ensure(['normal','important','urgent'].includes(t.priority),'优先级不正确');
 ensure(['todo','done'].includes(t.status),'任务状态不正确');
 ensure(t.focusDate===null||(date(t.focusDate)&&t.focusDate===t.plannedDate),'重点日期与计划日期不一致');
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
 const knowledgeIds=new Set();for(const k of state.knowledge){knowledgeValid(k);ensure(!knowledgeIds.has(k.id),'备份包含重复记背条目');knowledgeIds.add(k.id);}
 const ids=new Set(),focus=new Map();for(const t of state.tasks){taskValid(t);ensure(!ids.has(t.id),'备份包含重复任务');ids.add(t.id);if(t.status==='todo'&&t.focusDate){focus.set(t.focusDate,(focus.get(t.focusDate)||0)+1);ensure(focus.get(t.focusDate)<=3,'每天最多选择 3 项重点');}}
 const events=new Set();for(const e of state.events){ensure(e&&uuid(e.id)&&!events.has(e.id),'提醒记录重复或无效');events.add(e.id);ensure(uuid(e.taskId)&&ids.has(e.taskId)&&typeof e.title==='string'&&e.title.length<=200&&instant(e.createdAt)&&(e.readAt===null||instant(e.readAt)),'提醒记录格式不正确');}
 settingsValid(state.settings);
}
function validateBackup(input){
 ensure(input&&[1,2,3,4].includes(input.schemaVersion),'不支持此备份版本');
 const backup=clone(input);if(backup.schemaVersion===1)backup.knowledge=[];if(backup.schemaVersion<3&&Array.isArray(backup.knowledge))for(const k of backup.knowledge)if(k&&!Object.hasOwn(k,'tags'))k.tags=[];stateValid(backup);if(backup.schemaVersion===4)require('./media.cjs').validateAttachments(backup);return backup;
}
class Store{
 constructor(dbPath){
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  this.db=new DatabaseSync(dbPath);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS planner_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
  const row=this.db.prepare('SELECT data FROM planner_state WHERE id=1').get();
  this.state=row?JSON.parse(row.data):{tasks:[],events:[],knowledge:[],settings:clone(defaults)};
  let legacy=!Object.hasOwn(this.state,'knowledge');if(legacy)this.state.knowledge=[];
  if(Array.isArray(this.state.knowledge))for(const k of this.state.knowledge)if(k&&!Object.hasOwn(k,'tags')){k.tags=[];legacy=true;}
  stateValid(this.state);
  if(legacy)this.mutate(()=>{});
 }
 summary(){return {settings:clone(this.state.settings),unread:this.state.events.filter(e=>!e.readAt).length,done:this.state.tasks.filter(t=>t.status==='done'&&t.completedAt&&today(t.completedAt)===today()).length};}
 snapshot(){return clone(this.state);}
 mutate(fn){
  const next=clone(this.state);const result=fn(next);stateValid(next);
  this.db.exec('BEGIN IMMEDIATE');
  try{this.db.prepare('INSERT INTO planner_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(next));this.db.exec('COMMIT');}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw new Error('保存失败，请检查磁盘空间和数据目录权限后重试。',{cause:error});}
  this.state=next;return clone(result);
 }
 addKnowledge(input){return this.mutate(s=>{ensure(input&&typeof input==='object','记背内容格式不正确');const now=new Date().toISOString();const k={id:randomUUID(),title:typeof input.title==='string'?input.title.trim():input.title,content:input.content===undefined?'':input.content,pinned:input.pinned===undefined?false:input.pinned,tags:normalizeTags(input.tags===undefined?[]:input.tags),createdAt:now,updatedAt:now};knowledgeValid(k);s.knowledge.push(k);return k;});}
 updateKnowledge(id,patch){return this.mutate(s=>{const k=s.knowledge.find(k=>k.id===id);ensure(k,'记背条目不存在，请刷新列表');ensure(patch&&typeof patch==='object'&&!Array.isArray(patch),'记背修改格式不正确');for(const key of Object.keys(patch)){ensure(['title','content','pinned','tags'].includes(key),'不支持修改此记背字段');k[key]=key==='tags'?normalizeTags(patch[key]):key==='title'&&typeof patch[key]==='string'?patch[key].trim():patch[key];}k.updatedAt=new Date().toISOString();return k;});}
 deleteKnowledge(id){return this.mutate(s=>{ensure(s.knowledge.some(k=>k.id===id),'记背条目不存在，请刷新列表');s.knowledge=s.knowledge.filter(k=>k.id!==id);});}
 get(state,id){const t=state.tasks.find(t=>t.id===id);ensure(t,'任务不存在，请刷新列表');return t;}
 addTask(input){return this.mutate(s=>{const now=new Date().toISOString();const t={id:randomUUID(),title:typeof input.title==='string'?input.title.trim():input.title,notes:input.notes??'',plannedDate:input.plannedDate??null,priority:input.priority??'normal',status:'todo',focusDate:null,createdAt:now,updatedAt:now,completedAt:null,reminderAt:null,reminderRevision:0,remindedRevision:0};if(input.reminderAt!==undefined&&input.reminderAt!==null)this.reminder(t,input.reminderAt);taskValid(t);s.tasks.push(t);return t;});}
 reminder(t,value){ensure(value===null||(instant(value)&&Date.parse(value)>Date.now()),'提醒时间必须晚于现在，请重新选择');t.reminderAt=value===null?null:new Date(value).toISOString();t.reminderRevision++;}
 updateTask(id,patch){return this.mutate(s=>{const t=this.get(s,id);for(const key of Object.keys(patch))ensure(['title','notes','plannedDate','priority','status','reminderAt'].includes(key),'不支持修改此任务字段');if(Object.hasOwn(patch,'title'))t.title=typeof patch.title==='string'?patch.title.trim():patch.title;if(Object.hasOwn(patch,'notes'))t.notes=patch.notes;if(Object.hasOwn(patch,'plannedDate')&&patch.plannedDate!==t.plannedDate){t.plannedDate=patch.plannedDate;t.focusDate=null;}if(Object.hasOwn(patch,'priority'))t.priority=patch.priority;if(Object.hasOwn(patch,'reminderAt')&&patch.reminderAt!==t.reminderAt)this.reminder(t,patch.reminderAt);if(Object.hasOwn(patch,'status')&&patch.status!==t.status){t.status=patch.status;t.completedAt=t.status==='done'?new Date().toISOString():null;if(t.status==='done')t.remindedRevision=t.reminderRevision;else if(t.status==='todo'&&t.focusDate&&s.tasks.filter(a=>a.id!==t.id&&a.status==='todo'&&a.focusDate===t.focusDate).length>=3)t.focusDate=null;}t.updatedAt=new Date().toISOString();return t;});}
 deleteTask(id){return this.mutate(s=>{this.get(s,id);s.tasks=s.tasks.filter(t=>t.id!==id);s.events=s.events.filter(e=>e.taskId!==id);});}
 setSettings(patch){return this.mutate(s=>{s.settings={...s.settings,...patch};return s.settings;});}
 scheduleTasks(ids,value){return this.mutate(s=>{ensure(Array.isArray(ids),'请选择要安排的任务');ensure(value===null||date(value),'请选择有效的计划日期');return [...new Set(ids)].map(id=>{const t=this.get(s,id),old={id,plannedDate:t.plannedDate,focusDate:t.focusDate};if(t.plannedDate!==value){t.plannedDate=value;t.focusDate=null;t.updatedAt=new Date().toISOString();}return old;});});}
 undoSchedule(entries){return this.mutate(s=>{
  ensure(Array.isArray(entries),'撤销内容无效');
  const focusSkipped=[];
  // Restore all dates first so existing focus slots remain ahead of restored slots.
  for(const entry of entries){
   ensure(entry.plannedDate===null||date(entry.plannedDate),'撤销日期无效');
   ensure(entry.focusDate===null||(date(entry.focusDate)&&entry.focusDate===entry.plannedDate),'撤销重点日期无效');
   const t=this.get(s,entry.id);t.plannedDate=entry.plannedDate;
   if(t.focusDate!==t.plannedDate)t.focusDate=null;
   t.updatedAt=new Date().toISOString();
  }
  for(const entry of entries){
   const t=this.get(s,entry.id);
   if(!entry.focusDate||t.focusDate===entry.focusDate)continue;
   const count=s.tasks.filter(a=>a.status==='todo'&&a.focusDate===entry.focusDate).length;
   if(t.status==='done'||count<3)t.focusDate=entry.focusDate;
   else focusSkipped.push(t.title);
  }
  return {focusSkipped};
 });}
 toggleFocus(id,replaceId){return this.mutate(s=>{const t=this.get(s,id),day=today();ensure(t.status==='todo'&&t.plannedDate===day,'请先将待办任务安排到今天');if(t.focusDate===day)t.focusDate=null;else{const focused=s.tasks.filter(a=>a.status==='todo'&&a.focusDate===day);if(focused.length>=3){const old=focused.find(a=>a.id===replaceId);ensure(old,'今天最多选择 3 项重点，请先选择要替换的一项');old.focusDate=null;old.updatedAt=new Date().toISOString();}t.focusDate=day;}t.updatedAt=new Date().toISOString();return t;});}
 consume(s,now){const added=[];for(const t of s.tasks){if(t.status==='todo'&&t.reminderAt&&Date.parse(t.reminderAt)<=now&&t.remindedRevision<t.reminderRevision){const event={id:randomUUID(),taskId:t.id,title:t.title,createdAt:new Date(now).toISOString(),readAt:null};if(!s.events.some(e=>e.id===event.id)){s.events.push(event);added.push(event);}t.remindedRevision=t.reminderRevision;}}return added;}
 pollReminders(now=Date.now(),{silent=false}={}){ensure(Number.isFinite(now),'提醒检查时间无效');if(!this.state.tasks.some(t=>t.status==='todo'&&t.reminderAt&&Date.parse(t.reminderAt)<=now&&t.remindedRevision<t.reminderRevision))return [];return this.mutate(s=>this.consume(s,now));}
 markRead(){return this.mutate(s=>{const now=new Date().toISOString();for(const e of s.events)if(!e.readAt)e.readAt=now;});}
 exportBackup(){const {tasks,events,knowledge,settings}=this.snapshot();const portable={};for(const key of Object.keys(defaults))portable[key]=settings[key]??defaults[key];return validateBackup({schemaVersion:3,exportedAt:new Date().toISOString(),tasks,events,knowledge,settings:portable});}
 restoreBackup(input){const backup=validateBackup(input);return this.mutate(s=>{s.tasks=backup.tasks;s.events=backup.events;s.knowledge=backup.knowledge;for(const key of Object.keys(defaults))s.settings[key]=backup.settings[key]??defaults[key];this.consume(s,Date.now());});}
 close(){this.db.close();}
}
module.exports={Store,today,validateBackup};
