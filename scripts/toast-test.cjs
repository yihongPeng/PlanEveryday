// Headless regression on the actual UI and isolated Store. Never controls the desktop.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),uiRoot=process.env.PLANEVERYDAY_UI_ROOT||root;
const out=path.join(root,'test-results/toast');fs.mkdirSync(out,{recursive:true});
process.env.TEMP=process.env.TMP=path.join(out,'temp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const {chromium}=require('playwright'),{Store}=require(path.join(uiRoot,'src/store.cjs'));
const store=new Store(path.join(fs.mkdtempSync(path.join(out,'data-')),'planner.sqlite'));
const project=store.addProject({title:'提示自动收起检查'});
const stage=store.addStage({projectId:project.id,title:'练习',startDate:'2027-01-01',endDate:'2027-01-20'});
const task=store.addTask({title:'日期提示检查',projectId:project.id,stageId:stage.id,plannedDate:'2027-01-04',plannedEndDate:'2027-01-06'});
let browser,page;const errors=[],checks=[];
const current=()=>store.snapshot().tasks.find(item=>item.id===task.id);
async function schedule(start,end){
  await page.locator('.gantt-inspector [name=startDate]').fill(start);
  await page.locator('.gantt-inspector [name=endDate]').fill(end);
  await page.locator('.gantt-apply').click();
  await page.waitForFunction(()=>!document.querySelector('#toast').hidden&&document.querySelector('#toast').textContent.includes('任务日期已调整'));
}
async function visible(){return page.locator('#toast').isVisible();}
(async()=>{try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  page=await browser.newPage({viewport:{width:460,height:680}});page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.exposeFunction('toastInvoke',async(action,payload)=>{
    try{let data;if(action==='snapshot')data={...store.snapshot(),version:require('../package.json').version};
    else if(action==='scheduleTaskRange'||action==='undoTaskRange')data=store[action](payload);
    else if(action==='schedule')data=store.scheduleTasks(payload.ids,payload.date);
    else if(action==='undoSchedule')data=store.undoSchedule(payload);
    return {ok:true,data};}catch(error){return {ok:false,error:error.message};}
  });
  await page.addInitScript(()=>{let changed;window.planner={invoke:async(a,d)=>{const result=await window.toastInvoke(a,d);if(result.ok&&a!=='snapshot')queueMicrotask(()=>changed?.());return result;},onChange:fn=>changed=fn,onUpdate(){},onOpenTask(){}};});
  await page.goto(pathToFileURL(path.join(uiRoot,'src/ui/index.html')).href);
  await page.locator('[data-view=projects]:visible').first().click();await page.locator('[data-project-open]').click();
  await page.locator(`[data-task-id="${task.id}"] .gantt-task-bar .gantt-bar-move`).click();
  await schedule('2027-01-05','2027-01-07');await page.clock.fastForward(5100);
  const visibleAfterFiveSeconds=await visible();
  if(visibleAfterFiveSeconds){await page.clock.fastForward(4200);console.log(JSON.stringify({visibleAfterFiveSeconds,visibleAfterNineSeconds:await visible()}));}
  assert.equal(visibleAfterFiveSeconds,false,'Task date toast must dismiss after five seconds without further user input');
  assert.equal(current().plannedDate,'2027-01-05');checks.push('actual Gantt save dismisses after 5 seconds without reverting saved dates');
  await schedule('2027-01-06','2027-01-08');await page.clock.fastForward(3000);
  await schedule('2027-01-07','2027-01-09');await page.clock.fastForward(2300);assert(await visible(),'previous timer must not dismiss the latest result');
  await page.evaluate(()=>refresh());await page.clock.fastForward(2900);assert(!(await visible()),'background refresh must not extend the timer');checks.push('successive reschedules replace the old timer; refresh does not keep the toast alive');
  await schedule('2027-01-08','2027-01-10');await page.clock.fastForward(3500);await page.locator('#toast button').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已撤销任务改期'));assert.equal(current().plannedDate,'2027-01-07');
  await page.clock.fastForward(2000);assert(await visible(),'undo success gets its own timer');await page.clock.fastForward(1200);assert(!(await visible()));checks.push('undo works before expiry and its success message dismisses after 3 seconds');
  await page.evaluate(id=>schedule([id],'2027-01-10'),task.id);assert(await visible());await page.locator('#toast button').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已恢复原来的安排'));assert.equal(current().plannedDate,'2027-01-07');await page.clock.fastForward(3200);assert(!(await visible()));checks.push('existing quick-schedule array undo still restores both dates and dismisses');
  await page.evaluate(()=>toast('检查后台过期提示',()=>{}));
  await page.clock.setSystemTime(new Date((await page.evaluate(()=>Date.now()))+6000));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert(!(await visible()),'regaining focus must clear expired toasts even if timers were suspended');checks.push('expired toast clears when the window regains focus after suspended timers');
  await page.evaluate(()=>toast('检查重新显示',()=>{}));
  await page.clock.setSystemTime(new Date((await page.evaluate(()=>Date.now()))+6000));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert(!(await visible()));checks.push('expired toast clears when the document becomes visible again');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,mode:'headless real UI + isolated Store; controlled clock',checks},null,2));console.log(checks.map(c=>'PASS '+c).join('\n'));
}finally{await browser?.close();store.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
