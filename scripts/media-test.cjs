'use strict';
const {_electron:electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(root,'test-results','media-desktop-')),backup=path.join(data,'full-backup.json'),fixture=path.join(root,'assets','app.png');
let app,page;const errors=[],checks=[];
const executablePath=process.env.PLANEVERYDAY_EXE||path.join(root,'release/0.4.0/PlanEveryday-win32-x64/PlanEveryday.exe');
async function launch(directory=data){app=await electron.launch({executablePath,args:[],env:{...process.env,PLANEVERYDAY_DATA_DIR:directory,PLANEVERYDAY_TEST_NO_FOCUS:'1',PLANEVERYDAY_SUSPEND_MS:'500'}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('#quick-title').waitFor();}
async function api(action,data){const r=await page.evaluate(({action,data})=>window.planner.invoke(action,data),{action,data});if(!r.ok)throw Error(r.error);return r.data;}
async function check(label,fn){await fn();checks.push(label);console.log('PASS',label);}
async function memory(){await page.locator('[data-view="memory"]:visible').first().click();}
async function idle(){await page.waitForFunction(()=>!document.querySelector('[data-memory-save]')?.disabled);}
async function pasteOrDrop(kind){await page.locator('#memory-content').evaluate((el,{kind,bytes})=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],'截图.png',{type:'image/png'}));el.focus();el.setSelectionRange(el.value.length,el.value.length);const event=kind==='paste'?new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true});el.dispatchEvent(event);},{kind,bytes:[...fs.readFileSync(fixture)]});}
(async()=>{try{
 await launch();await memory();await page.locator('[data-memory-new]').first().click();await page.locator('#memory-title').fill('图片与代码验收');await page.locator('#memory-content').fill('# 图文复习\n\n```python\nfor day in range(3):\n    print("温习")\n```\n');
 await check('paste image, drop image and choose image insert local Markdown and deduplicate',async()=>{
  await pasteOrDrop('paste');await page.waitForFunction(()=>document.querySelector('#memory-content').value.includes('plan-image://'));await idle();
  await pasteOrDrop('drop');await page.waitForFunction(()=>document.querySelector('#memory-content').value.split('plan-image://').length===3);await idle();
  await app.evaluate(({dialog},fixture)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});},fixture);await page.locator('[data-memory-image]').click();await page.waitForFunction(()=>document.querySelector('#memory-content').value.split('plan-image://').length===4);await idle();
  assert.equal(fs.readdirSync(path.join(data,'images')).filter(x=>x.endsWith('.png')).length,1);
 });
 await check('cancel image picker and reject invalid/oversized files without losing draft',async()=>{
  const before=await page.locator('#memory-content').inputValue();await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await page.locator('[data-memory-image]').click();await idle();assert.equal(await page.locator('#memory-content').inputValue(),before);
  for(const size of [5,11*1024*1024]){const result=await page.evaluate(size=>window.planner.invoke('image:add',{bytes:new Uint8Array(size)}),size);assert.equal(result.ok,false);}assert.equal(await page.locator('#memory-content').inputValue(),before);
 });
 await page.locator('[data-memory-save]').click();await page.locator('#memory-reading-title').waitFor();
 await check('images decode offline, code highlights, small/large windows do not overflow',async()=>{
  await page.waitForFunction(()=>[...document.querySelectorAll('.memory-image')].length===3&&[...document.querySelectorAll('.memory-image')].every(i=>i.complete&&i.naturalWidth>0));assert.ok(await page.locator('.hljs-keyword').count());
  for(const width of [900,360]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setBounds({width,height:700}),width);await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(root,`test-results/media-${width}.png`)});}
 });
 await check('minimized window restores through shared pet/tray open path',async()=>{for(let i=0;i<5;i++){await api('minimize');await page.waitForTimeout(100);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized()),true);await app.evaluate(({app})=>app.emit('second-instance',{},[]));await page.waitForTimeout(200);assert.deepEqual(await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return [w.isMinimized(),w.isVisible()];}),[false,true]);}});
 let content=(await api('snapshot')).knowledge[0].content;
 await check('export includes attachments and restart keeps exact Markdown and image bytes',async()=>{
  await app.evaluate(({dialog},backup)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:backup});},backup);await api('export');const saved=JSON.parse(fs.readFileSync(backup));assert.equal(saved.schemaVersion,4);assert.equal(saved.attachments.length,1);await app.close();await launch();assert.equal((await api('snapshot')).knowledge[0].content,content);await memory();await page.locator('[data-memory-open]').click();await page.waitForFunction(()=>document.querySelector('.memory-image')?.naturalWidth>0);
 });
 await check('restore into empty D directory restores images; corrupted backup leaves content unchanged',async()=>{
  await app.close();await launch(path.join(data,'clean-restore'));await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});dialog.showMessageBox=async()=>({response:1});},backup);await api('import');await memory();await page.locator('[data-memory-open]').click();await page.waitForFunction(()=>document.querySelector('.memory-image')?.naturalWidth>0);assert.equal((await api('snapshot')).knowledge[0].content,content);
  const corrupt=JSON.parse(fs.readFileSync(backup));corrupt.attachments[0].data='AAAA';fs.writeFileSync(path.join(data,'bad.json'),JSON.stringify(corrupt));await app.evaluate(({dialog},bad)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[bad]});},path.join(data,'bad.json'));const r=await page.evaluate(()=>window.planner.invoke('import'));assert.equal(r.ok,false);assert.equal((await api('snapshot')).knowledge[0].content,content);
  assert.ok((await api('snapshot')).dataPath.startsWith('D:'));assert.ok(await app.evaluate(({app})=>app.getPath('sessionData').startsWith('D:')));
 });
 await check('valid backup repairs missing and corrupt existing attachments',async()=>{
  const imageFolder=path.join(data,'clean-restore','images'),name=fs.readdirSync(imageFolder).find(n=>n.endsWith('.png'));
  await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});},backup);
  for(const damaged of [true,false]){if(damaged)fs.writeFileSync(path.join(imageFolder,name),'broken');else fs.unlinkSync(path.join(imageFolder,name));await api('import');assert.equal((await api('snapshot')).knowledge[0].content,content);assert.ok(fs.readFileSync(path.join(imageFolder,name)).length>100);}
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'test-results/media-report.json'),JSON.stringify({passed:true,checks,limitations:['Paste/drop use browser File events; native picker return is stubbed','Window restore automated, physical native pet click requires user desktop verification']},null,2));
 }finally{if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

