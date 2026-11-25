const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../src/store.cjs');
function setup(t){const s=new Store(':memory:');t.after(()=>s.close());const p=s.addProject({title:'独立排期'}),stage=s.addStage({projectId:p.id,title:'阶段',startDate:'2027-01-04',endDate:'2027-01-10'});return {s,p,stage};}
const expected=s=>({startDate:s.startDate,endDate:s.endDate,updatedAt:s.updatedAt});
const request=(stage,startDate='2027-01-06',endDate='2027-01-12')=>({id:stage.id,startDate,endDate,expected:expected(stage)});
test('stage drag commits directly and undo leaves all task fields untouched',t=>{
 const {s,p,stage}=setup(t);s.addTask({title:'多日任务',projectId:p.id,stageId:stage.id,plannedDate:'2027-01-05',plannedEndDate:'2027-01-08',reminderAt:'2099-01-01T00:00:00Z'});const done=s.addTask({title:'已完成',projectId:p.id,stageId:stage.id,plannedDate:'2027-01-05'});s.updateTask(done.id,{status:'done'});s.addTask({title:'未安排',projectId:p.id,stageId:stage.id});const before=s.snapshot();const undo=s.scheduleStageRange(request(stage));assert.equal(s.snapshot().stages[0].startDate,'2027-01-06');assert.deepEqual(s.snapshot().tasks,before.tasks);s.undoStageSchedule(undo);assert.equal(s.snapshot().stages[0].startDate,stage.startDate);assert.deepEqual(s.snapshot().tasks,before.tasks);
});
test('stage scheduling rejects obsolete linked input and invalid ranges atomically',t=>{
 const {s,stage}=setup(t),before=s.snapshot();for(const input of [{...request(stage),shiftTasks:true},{...request(stage),endDate:'2027-01-01'},{...request(stage),startDate:null},{id:stage.id,startDate:null,endDate:null}]){assert.throws(()=>s.scheduleStageRange(input));assert.deepEqual(s.snapshot(),before);}assert.equal(s.previewStageSchedule,undefined);assert.equal(s.applyStageSchedule,undefined);
});
test('stage expected state prevents stale and replayed writes without coupling task edits',t=>{
 const {s,p,stage}=setup(t);s.addTask({title:'任务有变化不影响阶段',projectId:p.id,stageId:stage.id});const input=request(stage);s.scheduleStageRange(input);const before=s.snapshot();assert.throws(()=>s.scheduleStageRange(input),/变化/);assert.deepEqual(s.snapshot(),before);
});
test('failed stage save and undo keep their retry state and never move tasks',t=>{
 const {s,stage}=setup(t),input=request(stage),before=s.snapshot();s.db.exec('PRAGMA query_only=ON');assert.throws(()=>s.scheduleStageRange(input),/保存失败/);assert.deepEqual(s.snapshot(),before);s.db.exec('PRAGMA query_only=OFF');const undo=s.scheduleStageRange(input),saved=s.snapshot();s.db.exec('PRAGMA query_only=ON');assert.throws(()=>s.undoStageSchedule(undo),/保存失败/);assert.deepEqual(s.snapshot(),saved);s.db.exec('PRAGMA query_only=OFF');s.undoStageSchedule(undo);assert.equal(s.snapshot().stages[0].startDate,stage.startDate);
});
test('stage undo preserves later task edits and stage wording but refuses later stage dates',t=>{
 const {s,p,stage}=setup(t),task=s.addTask({title:'任务',projectId:p.id,stageId:stage.id,plannedDate:'2027-01-05'}),undo=s.scheduleStageRange(request(stage));s.updateTask(task.id,{plannedDate:'2027-02-01',notes:'保留'});s.updateStage(stage.id,{title:'新名称'});const tasks=s.snapshot().tasks;s.undoStageSchedule(undo);assert.deepEqual(s.snapshot().tasks,tasks);assert.equal(s.snapshot().stages[0].title,'新名称');const next=s.scheduleStageRange(request(s.snapshot().stages[0]));s.updateStage(stage.id,{startDate:'2027-01-07'});s.updateStage(stage.id,{startDate:'2027-01-06'});assert.throws(()=>s.undoStageSchedule(next),/变化/);
});
test('stage can clear and restore dates; backup restore invalidates undo',t=>{
 const {s,stage}=setup(t),undo=s.scheduleStageRange(request(stage,null,null));assert.equal(s.snapshot().stages[0].startDate,null);s.undoStageSchedule(undo);const next=s.scheduleStageRange(request(s.snapshot().stages[0]));s.restoreBackup(s.exportBackup());assert.throws(()=>s.undoStageSchedule(next),/撤销/);
});
test('stage date round-trip in one clock tick still invalidates expected state',t=>{
 const OriginalDate=Date;global.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-11-25T00:00:00Z']));}static now(){return OriginalDate.parse('2026-11-25T00:00:00Z');}};
 try{const {s,stage}=setup(t);s.updateStage(stage.id,{endDate:'2027-01-11'});s.updateStage(stage.id,{endDate:'2027-01-10'});assert.throws(()=>s.scheduleStageRange(request(stage)),/变化/);}finally{global.Date=OriginalDate;}
});
