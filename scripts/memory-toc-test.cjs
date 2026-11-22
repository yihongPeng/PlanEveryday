// Run with PLANEVERYDAY_EXE pointing to the isolated preview build; omit for source-mode regression.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),results=path.join(root,'test-results','memory-toc');
fs.mkdirSync(results,{recursive:true});
const data=fs.mkdtempSync(path.join(results,'data-'));
const {Store}=require('../src/store.cjs');
const initial=new Store(path.join(data,'planner.sqlite'));
initial.setSettings({petVisible:false,closeHintSeen:true,doNotDisturb:true});initial.close();
let app,page;const errors=[],checks=[];
const content='# 基础 **概念**\n\n'+('先理解含义，再结合例子复习。\n\n'.repeat(18))+'## 同名标题\n\n第一段。\n\n### 细节 `code`\n\n'+('这里是细节。\n\n'.repeat(18))+'## 同名标题\n\n第二段。\n\n```md\n# 不是目录\n```\n\n## 最后复习\n\n'+('最后的正文。\n\n'.repeat(20));
async function launch(){
 app=await electron.launch({executablePath:process.env.PLANEVERYDAY_EXE||path.join(root,'node_modules/electron/dist/electron.exe'),args:process.env.PLANEVERYDAY_EXE?[]:[root],env:{...process.env,PLANEVERYDAY_DATA_DIR:data,PLANEVERYDAY_TEST_NO_FOCUS:'1',PLANEVERYDAY_SUSPEND_MS:'600'}});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.body.dataset.page==='today');
}
const api=(action,payload)=>page.evaluate(async({action,payload})=>{const result=await window.planner.invoke(action,payload);if(!result.ok)throw Error(result.error);return result.data;},{action,payload});
async function openMemory(){await page.locator('[data-view="memory"]:visible').first().click();}
async function save(){await page.locator('[data-memory-save]').click();await page.locator('#memory-reading-title').waitFor();}
async function size(width,height){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).setBounds({width,height}),{width,height});await page.waitForTimeout(120);}
(async()=>{
 try{
  await launch();await openMemory();await page.locator('[data-memory-new]').first().click();
  assert.equal(await page.locator('#memory-toc-enabled').count(),1,'editor must offer the outline option');
  await page.locator('#memory-title').fill('目录验收');await page.locator('#memory-content').fill(content);
  assert.equal(await page.locator('#memory-toc-enabled').isChecked(),false);
  await page.locator('#memory-toc-enabled').check();await save();
  assert.equal(await page.locator('.memory-toc a').count(),5);
  const before=await api('snapshot');const item=before.knowledge[0];assert.equal(item.toc,true);assert.equal(item.content,content);
  const links=await page.locator('.memory-toc a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert.equal(new Set(links).size,5);assert.ok(!(await page.locator('.memory-toc').textContent()).includes('不是目录'));
  const indent=await page.locator('.memory-toc li').evaluateAll(nodes=>nodes.slice(0,3).map(n=>parseFloat(getComputedStyle(n).paddingLeft)));
  assert.ok(indent[1]>indent[0]&&indent[2]>indent[1],'outline nesting must be visibly indented under the application CSP');
  checks.push('option defaults off, persists without changing source; five parsed headings and unique links');
  for(const [width,height] of [[360,480],[460,680],[1200,850]]){
   await size(width,height);
   await page.locator('[data-memory-toc-top]').click();
   await page.locator('.memory-toc a').nth(3).click();
   const position=await page.evaluate(()=>{const target=document.activeElement,actions=document.querySelector('.memory-actions');return {id:target.id,top:target.getBoundingClientRect().top,barBottom:actions.getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal('#'+position.id,links[3]);assert.ok(position.top>=position.barBottom+4,JSON.stringify(position));assert.equal(position.overflow,false);
   assert.equal(new URL(page.url()).protocol,'file:');
   await page.locator('[data-memory-toc-top]').click();await page.screenshot({path:path.join(results,`reading-${width}.png`)});
  }
  await page.locator('.memory-toc a').nth(1).focus();await page.locator('.memory-toc a').nth(1).press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),links[1].slice(1));await page.locator('[data-memory-toc-top]').click();
  checks.push('actual DOM clicks navigate the second duplicate heading, retain local page and clear sticky toolbar at three sizes');
  await page.locator('.memory-toc summary').click();assert.equal(await page.locator('.memory-toc details').evaluate(el=>el.open),false);
  const close=page.waitForEvent('close');await page.locator('#hide').click();await close;
  await app.evaluate(({app})=>app.emit('second-instance',{},[]));page=await app.firstWindow();await page.locator('.memory-toc details').waitFor();
  assert.equal(await page.locator('.memory-toc details').evaluate(el=>el.open),false);
  await page.locator('[data-memory-edit]').click();assert.equal(await page.locator('#memory-content').inputValue(),content);
  await size(460,680);await page.locator('#memory-toc-enabled').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(results,'editor-460.png')});
  await page.locator('#memory-toc-enabled').uncheck();await page.locator('#memory-content').fill(content+'\n\n## 新增标题\n\n新增正文');
  const closeDraft=page.waitForEvent('close');await page.locator('#hide').click();await closeDraft;
  await app.evaluate(({app})=>app.emit('second-instance',{},[]));page=await app.firstWindow();await page.locator('#memory-content').waitFor();
  assert.equal(await page.locator('#memory-toc-enabled').isChecked(),false);assert.ok((await page.locator('#memory-content').inputValue()).endsWith('新增正文'));
  await page.locator('#memory-toc-enabled').check();await save();await page.locator('[data-memory-toc-top]').click();
  assert.equal(await page.locator('.memory-toc a').count(),6);checks.push('collapsed outline and edited toggle/text survive renderer suspension; headings update after save');
  const saved=await api('snapshot');await app.close();app=null;await launch();await openMemory();await page.locator('[data-memory-open]').first().click();
  assert.deepEqual((await api('snapshot')).knowledge,saved.knowledge);assert.equal(await page.locator('.memory-toc a').count(),6);checks.push('normal exit and reopen preserve outline option and exact Markdown');
  await page.locator('[data-memory-edit]').click();
  await page.locator('#memory-content').fill('# <img src=x onerror="window.tocXss=1">\n\n[网页](https://example.com/review)\n\n## 中文');await save();
  assert.equal(await page.locator('.memory-toc img,.memory-body img').count(),0);assert.equal(await page.evaluate(()=>window.tocXss),undefined);
  await app.evaluate(({shell})=>{globalThis.tocExternal=[];shell.openExternal=async url=>{globalThis.tocExternal.push(url);};});
  await page.locator('.memory-toc a').last().click();assert.deepEqual(await app.evaluate(()=>globalThis.tocExternal),[]);
  await page.locator('.memory-body a').click();assert.deepEqual(await app.evaluate(()=>globalThis.tocExternal),['https://example.com/review']);
  checks.push('escaped hostile heading stays text; outline links stay local while web links use the existing external-link service');
  await page.locator('[data-memory-edit]').click();await page.locator('#memory-toc-enabled').uncheck();await save();assert.equal(await page.locator('.memory-toc').count(),0);
  await page.locator('[data-memory-edit]').click();await page.locator('#memory-content').fill('没有标题的正文');await page.locator('#memory-toc-enabled').check();await save();assert.match(await page.locator('.memory-toc').textContent(),/添加.*标题/);
  checks.push('disabled outline is absent and an enabled outline without headings gives a useful hint');
  await page.locator('[data-memory-edit]').click();const long=Array.from({length:70},(_,i)=>`${i%2?'###':'#'} 第 ${i+1} 节 ${'长标题'.repeat(10)}\n\n正文\n`).join('\n');await page.locator('#memory-content').fill(long);await save();await size(360,480);
  assert.equal(await page.locator('.memory-toc a').count(),70);assert.ok(await page.locator('.memory-toc ol').evaluate(el=>el.scrollHeight>el.clientHeight));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(results,'long-outline-360.png')});checks.push('70 long headings scroll inside the outline without horizontal page overflow');
  assert.deepEqual(errors,[]);console.log('PASS '+checks.join('\nPASS '));
  fs.writeFileSync(path.join(results,'report.json'),JSON.stringify({passed:true,exe:process.env.PLANEVERYDAY_EXE||'source',data,checks},null,2));
 }finally{if(app)await app.close();}
})().catch(e=>{console.error(e);console.error('Page errors:',errors);fs.writeFileSync(path.join(results,'failure.txt'),e.stack||String(e));process.exitCode=1;});
