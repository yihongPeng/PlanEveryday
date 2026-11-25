'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Store,today,validateBackup}=require('../src/store.cjs');
const {Media}=require('../src/media.cjs');
const {testDirectory}=require('./test-paths.cjs');
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function setup(t){const dir=testDirectory('task-range-'),file=path.join(dir,'planner.sqlite');let s=new Store(file);t.after(()=>s.close());return {dir,file,get s(){return s;},reopen(){s.close();s=new Store(file);return s;}};}
function get(s,id){return s.snapshot().tasks.find(t=>t.id===id);}
function expected(task){return {plannedDate:task.plannedDate,plannedEndDate:task.plannedEndDate,updatedAt:task.updatedAt};}

test('task ranges persist inclusive endpoints and legacy callers preserve duration',t=>{
 const x=setup(t),s=x.s,task=s.addTask({title:'跨月',plannedDate:'2026-12-30',plannedEndDate:'2027-01-02'});
 assert.equal(task.plannedEndDate,'2027-01-02');assert.equal(s.addTask({title:'单日',plannedDate:'2026-11-25'}).plannedEndDate,'2026-11-25');
 assert.equal(s.updateTask(task.id,{plannedDate:'2027-02-27'}).plannedEndDate,'2027-03-02');
 assert.equal(s.updateTask(task.id,{plannedEndDate:'2027-03-05'}).plannedEndDate,'2027-03-05');
 assert.equal(x.reopen().snapshot().tasks[0].plannedEndDate,'2027-03-05');
 assert.equal(x.s.updateTask(task.id,{plannedDate:null}).plannedEndDate,null);
 assert.equal(x.s.updateTask(task.id,{plannedDate:'0001-01-01'}).plannedEndDate,'0001-01-01');
});
test('range validation rejects partial reverse malformed and overflowing dates atomically',t=>{
 const {s}=setup(t),task=s.addTask({title:'范围',plannedDate:'9999-12-30',plannedEndDate:'9999-12-31'}),before=s.snapshot();
 for(const patch of [{plannedDate:'9999-12-31'},{plannedEndDate:'9999-12-29'},{plannedDate:null,plannedEndDate:'9999-12-31'},{plannedEndDate:null},{plannedDate:'0000-01-01'},{plannedEndDate:'2026-02-30'}])assert.throws(()=>s.updateTask(task.id,patch),/日期|范围|开始|结束/);
 assert.deepEqual(s.snapshot(),before);assert.throws(()=>s.addTask({title:'只有结束',plannedEndDate:'2026-01-01'}));
});
test('range focus is shared across projects, stays only while contained and undo preserves newer focus slots',t=>{
 const {s}=setup(t),day=today(),tasks=Array.from({length:4},(_,i)=>s.addTask({title:'重点'+i,plannedDate:shift(day,-2),plannedEndDate:shift(day,3)}));
 tasks.slice(0,3).forEach(task=>s.toggleFocus(task.id));assert.throws(()=>s.toggleFocus(tasks[3].id),/3/);
 s.updateTask(tasks[0].id,{plannedDate:shift(day,-1)});assert.equal(get(s,tasks[0].id).focusDate,day);
 const undo=s.scheduleTasks([tasks[0].id],shift(day,1));assert.equal(get(s,tasks[0].id).plannedEndDate,shift(day,6));s.toggleFocus(tasks[3].id);
 assert.deepEqual(s.undoSchedule(undo),{focusSkipped:['重点0']});assert.equal(get(s,tasks[0].id).plannedEndDate,shift(day,4));
 assert.equal(get(s,tasks[0].id).focusDate,null);assert.equal(s.snapshot().tasks.filter(task=>task.focusDate===day).length,3);
});
test('batch range scheduling preserves each duration and refuses newer endpoint round-trips',t=>{
 const {s}=setup(t),a=s.addTask({title:'三天',plannedDate:'2026-12-30',plannedEndDate:'2027-01-01'}),b=s.addTask({title:'收集箱'}),undo=s.scheduleTasks([a.id,b.id],'2027-02-28');
 assert.equal(get(s,a.id).plannedEndDate,'2027-03-02');assert.equal(get(s,b.id).plannedEndDate,'2027-02-28');
 s.updateTask(a.id,{plannedEndDate:'2027-03-03'});s.updateTask(a.id,{plannedEndDate:'2027-03-02'});const before=s.snapshot();assert.throws(()=>s.undoSchedule(undo),/变化|撤销/);assert.deepEqual(s.snapshot(),before);
 const clear=s.scheduleTasks([a.id,b.id],null);assert.ok(s.snapshot().tasks.every(task=>task.plannedDate===null&&task.plannedEndDate===null));s.undoSchedule(clear);assert.equal(get(s,a.id).plannedEndDate,'2027-03-02');
});
test('direct range edits use expected state, opaque undo, and preserve completion and consumed reminders',t=>{
 const {s}=setup(t),when=Date.now()+60000,task=s.addTask({title:'完成一次',plannedDate:'2026-03-07',plannedEndDate:'2026-03-09',reminderAt:new Date(when).toISOString()});
 assert.equal(s.pollReminders(when).length,1);s.updateTask(task.id,{status:'done'});const done=get(s,task.id),undo=s.scheduleTaskRange({id:task.id,startDate:'2026-03-09',endDate:'2026-03-12',expected:expected(done)});
 assert.deepEqual(Object.keys(undo),['token']);assert.equal(get(s,task.id).status,'done');assert.equal(get(s,task.id).completedAt,done.completedAt);assert.equal(get(s,task.id).reminderAt,done.reminderAt);
 assert.throws(()=>s.scheduleTaskRange({id:task.id,startDate:'2026-03-10',endDate:'2026-03-12',expected:expected(done)}),/变化|重新/);
 s.updateTask(task.id,{title:'标题保留'});assert.deepEqual(s.undoTaskRange(undo),{focusSkipped:[]});assert.equal(get(s,task.id).plannedEndDate,'2026-03-09');assert.equal(get(s,task.id).title,'标题保留');assert.equal(s.pollReminders(when+1).length,0);assert.throws(()=>s.undoTaskRange(undo),/撤销/);
});
test('direct range save and undo failures are atomic and reusable',t=>{
 const x=setup(t),s=x.s,task=s.addTask({title:'可靠保存',plannedDate:'2026-11-25',plannedEndDate:'2026-11-27'}),request={id:task.id,startDate:'2026-11-26',endDate:'2026-11-29',expected:expected(task)},before=s.snapshot();
 s.db.exec('PRAGMA query_only=ON');assert.throws(()=>s.scheduleTaskRange(request),/保存失败/);assert.deepEqual(s.snapshot(),before);s.db.exec('PRAGMA query_only=OFF');const undo=s.scheduleTaskRange(request),after=s.snapshot();
 s.db.exec('PRAGMA query_only=ON');assert.throws(()=>s.undoTaskRange(undo),/保存失败/);assert.deepEqual(s.snapshot(),after);s.db.exec('PRAGMA query_only=OFF');s.undoTaskRange(undo);assert.equal(x.reopen().snapshot().tasks[0].plannedEndDate,'2026-11-27');
});
test('direct range undo rejects a later end-date edit and expires after backup restore',t=>{
 const {s}=setup(t),task=s.addTask({title:'冲突',plannedDate:'2026-11-25'}),move=()=>{const current=get(s,task.id);return s.scheduleTaskRange({id:task.id,startDate:'2026-11-26',endDate:'2026-11-28',expected:expected(current)});};
 const undo=move();s.updateTask(task.id,{plannedEndDate:'2026-11-29'});const before=s.snapshot();assert.throws(()=>s.undoTaskRange(undo),/变化|撤销/);assert.deepEqual(s.snapshot(),before);const next=move();s.restoreBackup(s.exportBackup());assert.throws(()=>s.undoTaskRange(next),/撤销/);
});
test('linked stage previews and undo shift both endpoints while preserving contained focus',t=>{
 const {s}=setup(t),day=today(),project=s.addProject({title:'项目'}),stage=s.addStage({projectId:project.id,title:'阶段',startDate:shift(day,-3),endDate:shift(day,3)}),task=s.addTask({title:'任务',projectId:project.id,stageId:stage.id,plannedDate:shift(day,-2),plannedEndDate:shift(day,2)});s.toggleFocus(task.id);
 const preview=s.previewStageSchedule({id:stage.id,startDate:shift(day,-2),endDate:shift(day,4),shiftTasks:true});assert.equal(preview.tasks[0].fromEnd,shift(day,2));assert.equal(preview.tasks[0].toEnd,shift(day,3));const undo=s.applyStageSchedule(preview);assert.equal(get(s,task.id).plannedEndDate,shift(day,3));assert.equal(get(s,task.id).focusDate,day);s.undoStageSchedule(undo);assert.equal(get(s,task.id).plannedEndDate,shift(day,2));
 const next=s.applyStageSchedule(s.previewStageSchedule({id:stage.id,startDate:shift(day,-2),endDate:shift(day,4),shiftTasks:true}));s.updateTask(task.id,{plannedEndDate:shift(day,4)});assert.throws(()=>s.undoStageSchedule(next),/变化|撤销/);
});
test('v6 backup includes ranges and images while v1-v5 normalize old tasks to one day',t=>{
 const {s,dir}=setup(t),project=s.addProject({title:'项目'}),stage=s.addStage({projectId:project.id,title:'阶段'}),task=s.addTask({title:'多日',plannedDate:'2026-11-25',plannedEndDate:'2026-11-30',projectId:project.id,stageId:stage.id}),media=new Media(dir),uri=media.add(fs.readFileSync(path.resolve('assets/app.png')));s.addKnowledge({title:'图片',content:`![](${uri})`});const backup=media.export(s.exportBackup());assert.equal(backup.schemaVersion,6);assert.equal(validateBackup(backup).tasks[0].plannedEndDate,'2026-11-30');assert.equal(backup.attachments.length,1);
 for(const version of [1,2,3,4,5]){const old=structuredClone(backup);old.schemaVersion=version;delete old.tasks[0].plannedEndDate;const parsed=validateBackup(old);assert.equal(parsed.tasks[0].plannedEndDate,task.plannedDate);if(version===5){assert.equal(parsed.tasks[0].stageId,stage.id);assert.equal(parsed.projects[0].id,project.id);}}
 const bad=structuredClone(backup);delete bad.tasks[0].plannedEndDate;assert.throws(()=>s.restoreBackup(bad));assert.equal(get(s,task.id).plannedEndDate,'2026-11-30');
});
for(const version of [0,1,2])test(`format ${version} migrates to 3 with a complete backup and preserves prior project links`,t=>{
 const x=setup(t),s=x.s,project=s.addProject({title:'试用内容'}),stage=s.addStage({projectId:project.id,title:'阶段'}),task=s.addTask({title:'原任务',plannedDate:'2026-11-25',projectId:project.id,stageId:stage.id}),media=new Media(x.dir),uri=media.add(fs.readFileSync(path.resolve('assets/app.png')));s.addKnowledge({title:'原图',content:`![](${uri})`});const legacy=s.snapshot();delete legacy.tasks[0].plannedEndDate;if(version<2){delete legacy.projects;delete legacy.stages;delete legacy.tasks[0].projectId;delete legacy.tasks[0].stageId;}s.db.prepare('UPDATE planner_state SET data=?').run(JSON.stringify(legacy));s.db.exec('PRAGMA user_version='+version);const upgraded=x.reopen();assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version,3);assert.equal(get(upgraded,task.id).plannedEndDate,task.plannedDate);if(version===2)assert.equal(get(upgraded,task.id).stageId,stage.id);const files=fs.readdirSync(path.join(x.dir,'backups')),backup=JSON.parse(fs.readFileSync(path.join(x.dir,'backups',files[0])));assert.equal(backup.schemaVersion,6);assert.equal(backup.attachments.length,1);validateBackup(backup);
});
test('format 2 failed migration preserves its exact original row and version',t=>{
 const dir=testDirectory('range-migration-failure-'),file=path.join(dir,'planner.sqlite'),source=new Store(':memory:');t.after(()=>source.close());source.addTask({title:'保留',plannedDate:'2026-11-25'});const state=source.snapshot();delete state.tasks[0].plannedEndDate;const original=JSON.stringify(state),db=new DatabaseSync(file);db.exec('CREATE TABLE planner_state(id INTEGER PRIMARY KEY,data TEXT); PRAGMA user_version=2');db.prepare('INSERT INTO planner_state VALUES(1,?)').run(original);db.exec("CREATE TRIGGER fail BEFORE UPDATE ON planner_state BEGIN SELECT RAISE(ABORT,'disk failure'); END");db.close();assert.throws(()=>new Store(file),/保存失败/);const check=new DatabaseSync(file);assert.equal(check.prepare('PRAGMA user_version').get().user_version,2);assert.equal(check.prepare('SELECT data FROM planner_state').get().data,original);check.close();
});
test('range expected state rejects a date round-trip within the same clock tick',t=>{
 const OriginalDate=Date;
 global.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-11-25T00:00:00.000Z']));}static now(){return OriginalDate.parse('2026-11-25T00:00:00.000Z');}};
 try{const {s}=setup(t),task=s.addTask({title:'并发改期',plannedDate:'2026-11-25',plannedEndDate:'2026-11-27'});s.updateTask(task.id,{plannedEndDate:'2026-11-28'});s.updateTask(task.id,{plannedEndDate:'2026-11-27'});const before=s.snapshot();assert.throws(()=>s.scheduleTaskRange({id:task.id,startDate:'2026-11-26',endDate:'2026-11-28',expected:expected(task)}),/变化|重新/);assert.deepEqual(s.snapshot(),before);}finally{global.Date=OriginalDate;}
});
for(const method of ['range','batch','stage'])test(`${method} undo preserves a focus explicitly removed after a focus-preserving move`,t=>{
 const {s}=setup(t),day=today(),project=s.addProject({title:'项目'}),stage=s.addStage({projectId:project.id,title:'阶段',startDate:shift(day,-1),endDate:shift(day,1)}),task=s.addTask({title:'保留主动取消',projectId:project.id,stageId:stage.id,plannedDate:shift(day,-1),plannedEndDate:shift(day,1)});s.toggleFocus(task.id);
 const undo=method==='range'?s.scheduleTaskRange({id:task.id,startDate:day,endDate:day,expected:expected(get(s,task.id))}):method==='batch'?s.scheduleTasks([task.id],day):s.applyStageSchedule(s.previewStageSchedule({id:stage.id,startDate:day,endDate:shift(day,2),shiftTasks:true}));
 assert.equal(get(s,task.id).focusDate,day);s.toggleFocus(task.id);assert.equal(get(s,task.id).focusDate,null);s[method==='range'?'undoTaskRange':method==='batch'?'undoSchedule':'undoStageSchedule'](undo);assert.equal(get(s,task.id).plannedDate,shift(day,-1));assert.equal(get(s,task.id).plannedEndDate,shift(day,1));assert.equal(get(s,task.id).focusDate,null);
});
