'use strict';
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'planeveryday-memory-'));
const results=path.join(root,'test-results');fs.mkdirSync(results,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report=[];let app;const errors=[];
async function check(label,fn){await fn();report.push(label);console.log('PASS',label);}
async function mainPage(){for(let i=0;i<100;i++){const page=app.windows().find(w=>w.url().endsWith('index.html'));if(page){await page.locator('#quick-title').waitFor({state:'attached'});page.on('pageerror',e=>errors.push(e.message));return page;}await sleep(100);}throw Error('No main window');}
async function memory(page){await page.locator('[data-view="memory"]:visible').first().click();await page.locator('[data-memory-new]').first().waitFor();}
async function snapshot(page){return (await page.evaluate(()=>window.planner.invoke('snapshot'))).data;}
(async()=>{try{
 app=await electron.launch({executablePath:process.env.PLANEVERYDAY_EXE||require('electron'),args:process.env.PLANEVERYDAY_EXE?[]:[root],env:{...process.env,PLANEVERYDAY_DATA_DIR:dataDir,PLANEVERYDAY_SUSPEND_MS:'500'},timeout:30000});
 let page=await mainPage();await memory(page);
 const title='记背测试：春日温习';const content='第一行：好好读书。\n\n第二行：慢慢记住。\n<img src=x onerror="window.__memoryXss=true">';
 await check('create plaintext multiline entry and open reading page',async()=>{
  await page.locator('[data-memory-new]').first().click();await page.locator('#memory-title').fill(title);await page.locator('#memory-content').fill(content);await page.locator('[data-memory-save]').click();await page.locator('#memory-reading-title').waitFor();assert.equal((await snapshot(page)).knowledge[0].content,content);assert.ok((await page.locator('.memory-body').textContent()).includes('<img src=x')); assert.equal(await page.locator('.memory-body img').count(),0);assert.equal(await page.evaluate(()=>window.__memoryXss),undefined);assert.equal((await snapshot(page)).knowledge.length,1);
 });
 await check('edit, retain search and pin entry',async()=>{
  await page.locator('[data-memory-edit]').click();await page.locator('#memory-content').fill(content+'\n新增温习句');await page.locator('[data-memory-save]').click();await page.locator('[data-memory-pin]').waitFor();await page.locator('[data-memory-pin]').click();await page.getByRole('button',{name:'取消置顶',exact:true}).waitFor();await page.locator('[data-memory-back]').click();await page.locator('#memory-search').fill('新增温习句');assert.equal(await page.locator('[data-memory-open]').count(),1);await page.locator('[data-memory-open]').focus();await page.locator('[data-memory-open]').press('Enter');await page.locator('#memory-reading-title').waitFor();await page.locator('[data-memory-back]').click();assert.equal(await page.locator('#memory-search').inputValue(),'新增温习句');await page.locator('#memory-search').fill('不存在的词语');await page.locator('[data-memory-clear]').first().waitFor();assert.equal(await page.locator('[data-memory-open]').count(),0);await page.locator('[data-memory-clear]').first().click();await page.locator('[data-memory-open]').click();
 });
 await check('draft and editor caret survive data refresh',async()=>{
  await page.locator('[data-memory-edit]').click();await page.locator('#memory-content').fill('未提交草稿\n'+'温习内容\n'.repeat(100));await page.locator('#memory-content').evaluate(el=>{el.focus();el.setSelectionRange(7,9);el.scrollTop=100;});await page.evaluate(()=>window.planner.invoke('settings',{doNotDisturb:true}));await sleep(300);assert.ok((await page.locator('#memory-content').inputValue()).startsWith('未提交草稿'));const caret=await page.locator('#memory-content').evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,scroll:el.scrollTop}));assert.equal(caret.start,7);assert.equal(caret.end,9);assert.ok(caret.scroll>0);
 });
 await check('hidden renderer is destroyed and draft restored on reopen',async()=>{
  await page.evaluate(()=>window.planner.invoke('settings',{closeHintSeen:true}));await page.locator('#hide').click();await page.waitForEvent('close',{timeout:10000});assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('index.html')).length),0);await app.evaluate(({app})=>app.emit('second-instance',{},[]));page=await mainPage();await page.locator('#memory-content').waitFor();assert.ok((await page.locator('#memory-content').inputValue()).startsWith('未提交草稿'));await page.locator('[data-memory-save]').click();await page.locator('#memory-reading-title').waitFor();
 });
 await check('reading actions remain visible on long text and layout fits 360x480',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).setBounds({width:360,height:480}));await sleep(200);await page.locator('#content').evaluate(el=>el.scrollTop=el.scrollHeight);const bounds=await page.locator('[data-memory-edit]').boundingBox();assert.ok(bounds&&bounds.y>=0&&bounds.y+bounds.height<480);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(results,'memory-small-reading.png')});
 });
 await check('restore resets stale editor drafts and selection',async()=>{
  await page.locator('[data-memory-edit]').click();await page.locator('#memory-content').fill('恢复前的未保存旧草稿');
  await page.evaluate(()=>{window.MemoryView.resetAfterRestore();});
  await page.evaluate(()=>window.planner.invoke('settings',{doNotDisturb:false}));await page.locator('[data-memory-open]').waitFor();
  assert.equal(await page.locator('#memory-content').count(),0);assert.equal(await page.locator('#memory-search').inputValue(),'');
  await page.locator('[data-memory-open]').click();await page.locator('[data-memory-edit]').click();assert.ok(!(await page.locator('#memory-content').inputValue()).includes('恢复前的未保存旧草稿'));
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(results,'memory-report.json'),JSON.stringify({passed:true,checks:report},null,2));
 }finally{if(app)await app.close();fs.rmSync(dataDir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(results,'memory-failure.txt'),error.stack||String(error));process.exitCode=1;});
