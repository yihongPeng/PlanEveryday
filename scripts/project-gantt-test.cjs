// Isolated, headless integration; never launches the installed application.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright'),{Store,today}=require('../src/store.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/project-gantt');
fs.mkdirSync(out,{recursive:true});process.env.TEMP=process.env.TMP=path.join(out,'temp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const data=fs.mkdtempSync(path.join(out,'data-')),store=new Store(path.join(data,'planner.sqlite'));
const checks=[],errors=[];let browser,page,session=null;
const date=(delta=0)=>{const d=new Date();d.setDate(d.getDate()+delta);return today(d);};
const project=store.addProject({title:'学会 Python 并完成小工具',outcome:'完成一个离线小工具',targetDate:date(20)});
const stage=store.addStage({projectId:project.id,title:'基础学习',startDate:date(-2),endDate:date(5)});
store.addStage({projectId:project.id,title:'整理与复盘'});
const task=store.addTask({title:'写三个字典练习',projectId:project.id,stageId:stage.id,plannedDate:date()});
const inbox=store.addTask({title:'整理函数笔记',projectId:project.id,stageId:stage.id});
store.addTask({title:'阶段外的预习任务',projectId:project.id,stageId:stage.id,plannedDate:date(-5)});
const free=store.addTask({title:'原有独立任务'});
const actions={snapshot:()=>({...store.snapshot(),version:'0.5.5',session}), 'session:restored':()=>{session=null;},'test:poll':()=>store.pollReminders(Date.now()+120000),
 add:x=>store.addTask(x),update:x=>store.updateTask(x.id,x.patch),delete:x=>{store.deleteTask(x.id);return true;},schedule:x=>store.scheduleTasks(x.ids,x.date),undoSchedule:x=>store.undoSchedule(x),focus:x=>store.toggleFocus(x.id,x.replaceId),
 addProject:x=>store.addProject(x),updateProject:x=>store.updateProject(x.id,x.patch),deleteProject:x=>store.deleteProject(x.id),addStage:x=>store.addStage(x),updateStage:x=>store.updateStage(x.id,x.patch),deleteStage:x=>store.deleteStage(x.id),assignTasks:({ids,...x})=>store.assignTasks(ids,x),previewStageSchedule:x=>store.previewStageSchedule(x),applyStageSchedule:x=>store.applyStageSchedule(x),undoStageSchedule:x=>store.undoStageSchedule(x),confirmDiscard:()=>true,readEvents:()=>store.markRead(),maximize:()=>true};
async function open(width=1280,height=850){
 page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('testInvoke',async(action,payload)=>{try{assert(actions[action],`unexpected action ${action}`);return {ok:true,data:await actions[action](payload)};}catch(e){return {ok:false,error:e.message};}});
 await page.addInitScript(()=>{let changed;window.planner={async invoke(a,d){const result=await window.testInvoke(a,d);if(result.ok&&!['snapshot','previewStageSchedule'].includes(a))changed?.();return result;},onUpdate(){},onChange(fn){changed=fn;},onOpenTask(){}};});
 await page.goto(pathToFileURL(path.join(process.env.PLANEVERYDAY_UI_ROOT||root,'src/ui/index.html')).href);
 await page.waitForFunction(()=>document.body.dataset.page);await tick();
}
async function tick(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function nav(view){await page.locator(`[data-view="${view}"]:visible`).first().click();await tick();}
async function projectPage(){await nav('projects');if(await page.locator('[data-project-back]').count())await page.locator('[data-project-back]').click();await page.locator(`[data-project-open="${project.id}"]`).click();await tick();}
async function noOverflow(label){const measure=await page.evaluate(()=>({page:document.documentElement.scrollWidth,width:innerWidth,content:document.querySelector('#content').scrollWidth,client:document.querySelector('#content').clientWidth}));assert(measure.page<=measure.width&&measure.content<=measure.client+2,`${label} overflow: ${JSON.stringify(measure)}`);}
(async()=>{try{
 browser=await chromium.launch({channel:'msedge',headless:true});await open();
 assert(await page.locator(`[data-task="${task.id}"]`).isVisible());
 await page.locator(`[data-task="${task.id}"] [data-complete]`).click();await page.waitForFunction(id=>document.querySelector(`[data-task="${id}"]`)?.classList.contains('is-done'),task.id);
 assert.equal(store.snapshot().tasks.find(t=>t.id===task.id).status,'done');
 await projectPage();assert.equal(await page.locator(`[data-task="${task.id}"]`).count(),1);checks.push('今日完成与项目共享同一任务 ID');
 await nav('inbox');assert(await page.locator(`[data-task="${inbox.id}"]`).isVisible());assert(await page.locator(`[data-task="${free.id}"]`).isVisible());
 await page.locator(`[data-detail="${free.id}"]`).click();await page.locator('#detail [name=projectId]').selectOption(project.id);await page.locator('#detail [name=stageId]').selectOption(stage.id);await page.locator('#detail [type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('修改已保存'));assert.equal(store.snapshot().tasks.find(t=>t.id===free.id).stageId,stage.id);assert.equal(store.snapshot().tasks.length,4);
 await page.locator('#detail-close').click();checks.push('既有任务归入项目不复制，收集箱保留所有未排期任务');
 const group=page.locator(`[data-inbox-group="${project.id}"]`);await group.locator('summary').click();await tick();
 await nav('today');await nav('inbox');assert.equal(await group.getAttribute('open'),null);
 await page.locator('#search').fill('函数');await tick();assert(await page.locator(`[data-task="${inbox.id}"]`).isVisible());await page.locator('#search').fill('');await tick();assert.equal(await group.getAttribute('open'),null);checks.push('收集箱记住项目折叠，搜索自动显示命中任务');
 await nav('future');await page.locator('#plan-project-filter').selectOption(project.id);await page.locator('#plan-stage-filter').selectOption(stage.id);assert(await page.locator(`[data-assign="${inbox.id}"]`).isVisible());
 await page.locator(`[data-assign="${inbox.id}"]`).click();await tick();assert.equal(store.snapshot().tasks.find(t=>t.id===inbox.id).plannedDate,date());checks.push('七天安排按项目/阶段筛选并安排原任务');
 await nav('inbox');await page.locator('#multi-toggle').click();await group.locator('summary').click();await page.locator(`[data-select="${free.id}"]`).check();await page.locator('#batch-project').click();await page.locator('#assignment-form [name=projectId]').selectOption('');await page.locator('#assignment-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#assignment-dialog').open);assert.equal(store.snapshot().tasks.find(t=>t.id===free.id).projectId,null);checks.push('批量调整归属与日期操作保持独立');
 await page.locator(`[data-detail="${free.id}"]`).click();await page.locator('#detail [name=notes]').fill('归入阶段前保留的备注草稿');await page.locator('#detail-close').click();
 await projectPage();await page.locator('[data-project-assign]').click();await page.locator('#project-assign-stage').selectOption(stage.id);await page.locator(`[data-project-assign-select="${free.id}"]`).check();await page.locator('#project-assignment-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#project-dialog'));
 await page.locator(`[data-detail="${free.id}"]`).click();assert.equal(await page.locator('#detail [name=stageId]').inputValue(),stage.id,'A disabled stage field omitted from an earlier draft must follow the saved assignment');assert.equal(await page.locator('#detail [name=notes]').inputValue(),'归入阶段前保留的备注草稿');await page.locator('#detail [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('修改已保存'));await tick();assert.equal(store.snapshot().tasks.find(t=>t.id===free.id).stageId,stage.id);
 await page.locator('#detail [name=stageId]').selectOption('');store.updateTask(free.id,{priority:'important'});await page.evaluate(()=>refresh());assert.equal(await page.locator('#detail [name=stageId]').inputValue(),'','An intentionally cleared stage must remain cleared across saved task refreshes');await page.locator('#detail [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('修改已保存'));await tick();assert.equal(store.snapshot().tasks.find(t=>t.id===free.id).stageId,null);await page.locator('#detail-close').click();checks.push('未归项目的备注草稿跟随新阶段归属，主动清除阶段仍可保存');
 await projectPage();await page.locator('button[data-project-tab="tasks"]').click();
 await page.locator(`[data-detail="${inbox.id}"]`).click();await page.locator('#detail [name=notes]').fill('未保存的备注，不应改回新安排日期');await page.locator('#detail-close').click();
 await page.locator(`[data-stage-schedule="${stage.id}"]`).first().click();await page.locator('#project-schedule-start').fill(date(0));await page.locator('#project-schedule-end').fill(date(7));await page.locator('#project-shift-tasks').check();
 await page.waitForFunction(()=>document.querySelector('.project-schedule-preview')?.textContent.includes('将移动 2 项'));
 await page.locator('#project-schedule-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#project-dialog'));
 assert.equal(store.snapshot().tasks.find(t=>t.id===inbox.id).plannedDate,date(2));assert.equal(store.snapshot().tasks.find(t=>t.id===task.id).plannedDate,date());
 await page.locator(`[data-detail="${inbox.id}"]`).click();assert.equal(await page.locator('#detail [name=plannedDate]').inputValue(),date(2));assert.equal(await page.locator('#detail [name=notes]').inputValue(),'未保存的备注，不应改回新安排日期');await page.locator('#detail-close').click();
 await page.locator('#toast button').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已撤销')||document.querySelector('#toast').textContent.includes('已恢复'));assert.equal(store.snapshot().tasks.find(t=>t.id===inbox.id).plannedDate,date());checks.push('实际改期确认与撤销联动每日清单，已完成任务不平移');
 await page.evaluate(async({id,at})=>{await window.planner.invoke('update',{id,patch:{reminderAt:at}});},{id:inbox.id,at:new Date(Date.now()+60000).toISOString()});await tick();
 await page.locator(`[data-detail="${inbox.id}"]`).click();await page.locator('#detail [name=notes]').fill('正在编辑的备注');await page.locator('#detail [name=notes]').evaluate(e=>e.setSelectionRange(2,2));
 await page.evaluate(()=>window.planner.invoke('test:poll'));await tick();assert.equal(await page.evaluate(()=>document.activeElement.name),'notes');assert.equal(await page.locator('#detail [name=notes]').evaluate(e=>e.selectionStart),2);assert.equal(await page.locator('#detail [name=notes]').inputValue(),'正在编辑的备注');await page.locator('#detail-close').click();checks.push('后台提醒记录刷新不打断详情输入焦点和光标');
 for(const [w,h] of [[360,480],[460,680],[1280,850]]){await page.setViewportSize({width:w,height:h});await projectPage();await page.locator('button[data-project-tab="tasks"]').click();await noOverflow('project '+w);assert(await page.locator('.project-scroll').evaluate(e=>e.clientHeight)>=120,'task viewing area must remain usable at '+w);await page.locator('#toast').evaluate(e=>e.hidden=true);await page.screenshot({path:path.join(out,`tasks-${w}.png`)});await page.locator('button[data-project-tab="gantt"]').click();await tick();await noOverflow('gantt '+w);assert(await page.locator('.gantt-viewport').evaluate(e=>e.clientHeight)>=120,'gantt viewing area must remain usable at '+w);await page.screenshot({path:path.join(out,`gantt-${w}.png`)});}
 checks.push('项目任务与甘特图在三种尺寸无页面横向溢出');
 await page.locator('button[data-project-tab="tasks"]').click();await page.locator('#project-task-title').fill('尚未保存的项目草稿');
 session=await page.evaluate(()=>window.captureSessionState());await page.close();await open(460,680);assert.equal(await page.locator('#project-task-title').inputValue(),'尚未保存的项目草稿');await page.locator('#project-task-title').press('Enter');await page.waitForFunction(()=>document.querySelector('#project-task-title').value==='');assert.equal(store.snapshot().tasks.filter(t=>t.title==='尚未保存的项目草稿').length,1);checks.push('应用会话恢复项目与录入草稿，保存只新增一次');
 const filterStage=store.addStage({projectId:project.id,title:'待删除的筛选阶段'}),filterTask=store.addTask({title:'删除阶段后仍待安排',projectId:project.id,stageId:filterStage.id});await page.evaluate(()=>refresh());
 await nav('future');await page.locator('#plan-project-filter').selectOption(project.id);await page.locator('#plan-stage-filter').selectOption(filterStage.id);assert(await page.locator(`[data-assign="${filterTask.id}"]`).isVisible());
 await projectPage();await page.locator(`[data-stage-edit="${filterStage.id}"]`).click();await page.locator(`[data-stage-delete="${filterStage.id}"]`).click();await page.locator('[data-project-confirm]').click();await page.waitForFunction(()=>!document.querySelector('#project-dialog'));assert.equal(store.snapshot().tasks.find(t=>t.id===filterTask.id).stageId,null);
 await nav('future');assert.equal(await page.locator('#plan-stage-filter').inputValue(),'');assert(await page.locator(`[data-assign="${filterTask.id}"]`).isVisible(),'Deleted stage filters must not hide tasks behind a visible all-stages choice');await page.locator('#plan-stage-filter').selectOption('unassigned');assert(await page.locator(`[data-assign="${filterTask.id}"]`).isVisible());checks.push('删除阶段后七天安排清除失效筛选，未分阶段筛选仍有效');
 await nav('more');await page.locator('[data-view="settings"]:visible').click();assert(await page.locator('#content').textContent().then(t=>t.includes('备份')));checks.push('小窗更多入口可访问设置和备份');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,mode:'headless Chromium + actual local UI + isolated Store; no native UI interaction',data,checks},null,2));console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser?.close();store.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
