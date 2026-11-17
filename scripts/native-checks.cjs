const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Store, today } = require('../src/store.cjs');
const root = path.resolve(__dirname,'..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'planeveryday-native-'));
const executablePath = process.env.PLANEVERYDAY_EXE || require('electron');
const args = process.env.PLANEVERYDAY_EXE ? [] : [root];
const pause = ms => new Promise(r=>setTimeout(r,ms));
const seed = new Store(path.join(dataDir,'planner.sqlite'));
for(let i=0;i<1000;i++) seed.addTask({title:`性能验证任务 ${String(i).padStart(4,'0')}`,plannedDate:today()});
seed.setSettings({doNotDisturb:true}); seed.close();
let app; const report={dataDir,executablePath,checks:[]};
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS',name);}
(async()=>{try{
 const start=Date.now(); app=await electron.launch({executablePath,args,env:{...process.env,PLANEVERYDAY_DATA_DIR:dataDir}});
 await app.firstWindow(); let page; for(let i=0;i<50;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));if(page)break;await pause(100);}
 page.setDefaultTimeout(10000); await page.locator('.task-row').first().waitFor();report.startupWith1000TasksMs=Date.now()-start;
 const call=(action,data)=>page.evaluate(async({action,data})=>{const r=await window.planner.invoke(action,data);if(!r.ok)throw Error(r.error);return r.data;},{action,data});
 await check('1000 tasks search correctly',async()=>{const t=Date.now();await page.locator('#search').fill('0999');await page.getByText('性能验证任务 0999',{exact:true}).waitFor();assert.equal(await page.locator('.task-row').count(),1);report.searchMs=Date.now()-t;});
 await check('ten maximize-restore cycles retain draft',async()=>{await page.locator('#quick-title').fill('保留草稿');for(let i=0;i<10;i++){await call('maximize');await call('maximize');}assert.equal(await page.locator('#quick-title').inputValue(),'保留草稿');});
 await check('second launch activates existing instance and exits',async()=>{
  const child=spawn(executablePath,args,{env:{...process.env,PLANEVERYDAY_DATA_DIR:dataDir},stdio:'ignore',windowsHide:true});
  await Promise.race([new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);}),pause(10000).then(()=>{throw Error('second instance did not exit');})]);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
 });
 await check('reminder due scan persists once and completion cancels another',async()=>{
  const reminderAt=new Date(Date.now()+1500).toISOString();
  const first=await call('add',{title:'到期提醒集成验证',reminderAt});
  const second=await call('add',{title:'完成后不提醒',reminderAt});await call('update',{id:second.id,patch:{status:'done'}});
  for(let i=0;i<30;i++){const s=await call('snapshot');if(s.events.some(e=>e.taskId===first.id))break;await pause(300);}
  const s=await call('snapshot');assert.equal(s.events.filter(e=>e.taskId===first.id).length,1);assert.equal(s.events.filter(e=>e.taskId===second.id).length,0);
  await pause(3300);assert.equal((await call('snapshot')).events.filter(e=>e.taskId===first.id).length,1);
 });
 await check('backup export and restore through IPC with dialog responses',async()=>{
  const file=path.join(dataDir,'test-backup.json');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});},file);
  assert.equal(await call('export'),true);assert.ok(fs.existsSync(file));
  const before=(await call('snapshot')).tasks.length;await call('add',{title:'恢复时移除'});assert.equal(await call('import'),true);assert.equal((await call('snapshot')).tasks.length,before);assert.ok(fs.readdirSync(path.join(dataDir,'backups')).length);
  fs.writeFileSync(file,'{"schemaVersion":999}');await assert.rejects(()=>call('import'));assert.equal((await call('snapshot')).tasks.length,before);
 });
 await check('native pet reports actual hidden and visible states',async()=>{await call('settings',{petVisible:false});await pause(200);assert.equal((await call('snapshot')).pet.status.nativeVisible,false);await call('settings',{petVisible:true});await pause(200);assert.equal((await call('snapshot')).pet.status.nativeVisible,true);});
 await check('native pet crash is recoverable without losing planner state',async()=>{const prior=await call('snapshot');process.kill(prior.pet.pid);await pause(200);assert.equal((await call('snapshot')).petError,true);await call('settings',{petVisible:true});await pause(600);const next=await call('snapshot');assert.notEqual(next.pet.pid,prior.pet.pid);assert.equal(next.pet.status.nativeVisible,true);assert.equal(next.tasks.length,prior.tasks.length);});
 report.metrics=await app.evaluate(({app,screen})=>({processes:app.getAppMetrics().map(p=>({type:p.type,cpu:p.cpu,memory:p.memory})),display:screen.getPrimaryDisplay()}));
 report.passed=true;fs.writeFileSync(path.join(root,'test-results','native-report.json'),JSON.stringify(report,null,2));
}finally{if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
