const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'yaya-notify-'));
const exe=process.env.PLANEVERYDAY_EXE||require('electron'),pause=ms=>new Promise(r=>setTimeout(r,ms));
let app,shortcut;const checks=[];
async function pageFor(){for(let i=0;i<80;i++){const p=app.windows().find(w=>w.url().endsWith('index.html'));if(p){await p.locator('#quick-title').waitFor();return p;}await pause(100);}throw Error('window unavailable');}
(async()=>{try{
 app=await electron.launch({executablePath:exe,args:process.env.PLANEVERYDAY_EXE?[]:[root],env:{...process.env,PLANEVERYDAY_DATA_DIR:data,PLANEVERYDAY_SUSPEND_MS:'500'}});await app.firstWindow();let page=await pageFor();page.setDefaultTimeout(10000);
 shortcut=await app.evaluate(({app,shell,Notification},root)=>{
  const file=app.getPath('appData')+'\\Microsoft\\Windows\\Start Menu\\Programs\\芽芽计划-临时验收.lnk';
  if(!shell.writeShortcutLink(file,'create',{target:app.getPath('exe'),args:app.isPackaged?'':'"'+root+'"',appUserModelId:'local.PlanEveryday.QA'}))throw Error('QA shortcut failed');
  globalThis.notificationLog=[];globalThis.testNotices=[];
  const show=Notification.prototype.show;Notification.prototype.show=function(){globalThis.testNotices.push(this);this.on('show',()=>globalThis.notificationLog.push({event:'show',title:this.title}));this.on('failed',(_,error)=>globalThis.notificationLog.push({event:'failed',error}));return show.call(this);};return file;
 },root);
 const call=(action,data)=>page.evaluate(async({action,data})=>{const r=await window.planner.invoke(action,data);if(!r.ok)throw Error(r.error);return r.data;},{action,data});
 await call('settings',{closeHintSeen:true});
 const task=await call('add',{title:'验收：关闭窗口后仍然到时提醒',reminderAt:new Date(Date.now()+4500).toISOString()});
 await page.locator('#hide').click();await pause(1600);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),0);await pause(5200);
 const delivery=await app.evaluate(()=>globalThis.notificationLog);assert.ok(delivery.some(x=>x.event==='show'),JSON.stringify(delivery));checks.push('real Windows notification show event after renderer released');
 await app.evaluate(()=>globalThis.testNotices.at(-1).emit('click'));page=await pageFor();await page.locator('[name=title]').waitFor();assert.equal(await page.locator('[name=title]').inputValue(),task.title);checks.push('notification click handler recreates renderer and locates task (callback simulated)');
 const before=(await call('snapshot')).events.length;await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));assert.equal((await call('snapshot')).events.length,before);checks.push('resume event does not duplicate delivered reminder (event simulated)');
 await call('settings',{doNotDisturb:true});const beforeNotices=await app.evaluate(()=>globalThis.testNotices.length);await call('add',{title:'验收：免打扰只记录',reminderAt:new Date(Date.now()+1100).toISOString()});await pause(3600);assert.equal(await app.evaluate(()=>globalThis.testNotices.length),beforeNotices);assert.equal((await call('snapshot')).events.length,before+1);checks.push('do-not-disturb records reminder without OS notification');
 await assert.rejects(()=>call('notification:test'));checks.push('test notification respects do-not-disturb');
 const report={passed:true,checks,delivery};fs.writeFileSync(path.join(root,'test-results','notification-report.json'),JSON.stringify(report,null,2));console.log(report);
}finally{if(app)await app.close();if(shortcut&&path.basename(shortcut)==='芽芽计划-临时验收.lnk')fs.rmSync(shortcut,{force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
