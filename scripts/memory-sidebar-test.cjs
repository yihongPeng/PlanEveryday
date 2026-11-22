// Headless only: no visible windows, desktop input, production database or system integrations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright'),{Store}=require('../src/store.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/memory-sidebar');
fs.mkdirSync(out,{recursive:true});process.env.TEMP=process.env.TMP=path.join(out,'temp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const data=fs.mkdtempSync(path.join(out,'data-')),store=new Store(path.join(data,'planner.sqlite'));
const source=Array.from({length:30},(_,i)=>`${i%3?'##':'#'} ${i===4||i===8?'重复标题':`第 ${i+1} 节 · 复习要点`}\n\n${'把一个概念讲清楚，再用例子检验理解。\n\n'.repeat(6)}`).join('\n');
const note=store.addKnowledge({title:'长期阅读与侧栏目录',content:source,toc:true,tags:['阅读验收']});
const checks=[],errors=[],external=[];let browser,page,session=null;
async function open(width=1280,height=850){
 const expectedView=session?.view||'today';
 page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('testInvoke',async(action,payload)=>{try{
  let result;if(action==='snapshot')result={...store.snapshot(),version:require('../package.json').version,session};
  else if(action==='session:restored')session=null;
  else if(action==='knowledge:add')result=store.addKnowledge(payload);
  else if(action==='knowledge:update')result=store.updateKnowledge(payload.id,payload.patch);
  else if(action==='openLink')external.push(payload.url);
  else throw Error('Unexpected test action '+action);
  return {ok:true,data:result};
 }catch(e){return {ok:false,error:e.message};}});
 await page.addInitScript(()=>{window.planner={invoke:(a,d)=>window.testInvoke(a,d),onUpdate(){},onChange(){},onOpenTask(){}};});
 const sourceRoot=process.env.PLANEVERYDAY_UI_ROOT||root;
 await page.goto(pathToFileURL(path.join(sourceRoot,'src/ui/index.html')).href);
 await page.waitForFunction(view=>document.body.dataset.page===view,expectedView);
}
async function read(){await page.locator('[data-view="memory"]:visible').first().click();await page.locator('[data-memory-open]').first().click();}
async function tick(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function setSize(width,height){await page.setViewportSize({width,height});await tick();}
async function visiblePanel(){if(await page.locator('.memory-toc').isHidden())await page.locator('[data-memory-toc-toggle]').click();await tick();}
async function save(){await page.locator('[data-memory-save]').click();await page.locator('#memory-reading-title').waitFor();await tick();}
(async()=>{try{
 browser=await chromium.launch({channel:'msedge',headless:true});await open();await read();
 assert.equal(await page.locator('.memory-reading-scroll').count(),1,'reading must use its own scroll area beside the persistent outline');
 await tick();assert.equal(await page.locator('.memory-toc').isVisible(),true);
 await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop=el.scrollHeight/2);await tick();
 const visible=await page.locator('.memory-toc').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=44&&r.bottom<=innerHeight&&r.height>200;});assert(visible,'outline must stay inside the viewport halfway through a long note');
 const middleScroll=await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop);
 await page.locator('.memory-toc ol').evaluate(el=>el.scrollTop=el.scrollHeight);await tick();assert.equal(await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop),middleScroll);
 await page.screenshot({path:path.join(out,'wide-midway.png')});checks.push('wide outline stays visible through long-body scrolling and scrolls independently');
 const links=await page.locator('.memory-toc a').evaluateAll(items=>items.map(n=>n.getAttribute('href')));
 assert.equal(new Set(links).size,30);
  await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await tick();
  assert.equal(await page.locator('.memory-toc a[aria-current="location"]').getAttribute('href'),links.at(-1));
  assert.equal(await page.locator('[data-memory-toc-toggle]').isVisible(),true,'outline control must remain visible at the end of the note');
 await page.locator('.memory-toc a').nth(8).click();await tick();
 assert.equal(await page.evaluate(()=>document.activeElement.id),links[8].slice(1));
 assert.equal(await page.locator('.memory-toc a[aria-current="location"]').getAttribute('href'),links[8]);
 assert(await page.locator('.memory-toc').isVisible(),'jump must not dismiss the outline');
 for(const [width,height] of [[360,480],[460,680],[800,650],[1280,850]]){
  await setSize(width,height);await visiblePanel();await page.locator('.memory-toc a').nth(17).click();await tick();
  const r=await page.evaluate(()=>{const pane=document.querySelector('.memory-toc').getBoundingClientRect(),body=document.querySelector('.memory-reading-scroll').getBoundingClientRect(),h=document.activeElement.getBoundingClientRect(),toolbar=document.querySelector('.memory-actions').getBoundingClientRect();return {inside:pane.top>=toolbar.bottom-1&&pane.bottom<=innerHeight-((innerWidth<760)?56:0),heading:h.top>=body.top&&h.top<body.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert(r.inside&&r.heading&&!r.overflow,JSON.stringify({width,...r}));
  await page.screenshot({path:path.join(out,`reading-${width}.png`)});
 }
 checks.push('duplicate heading targets, current-section marking and persistent outline at four viewport sizes');
  const widthScroll=await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop);
  await setSize(460,680);assert(await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop)>0);
  await setSize(1280,850);const resizeState=await page.evaluate(()=>({top:document.querySelector('.memory-reading-scroll').scrollTop,current:document.querySelector('.memory-toc a[aria-current]')?.getAttribute('href')}));assert(Math.abs(resizeState.top-widthScroll)<2,JSON.stringify({before:widthScroll,...resizeState}));
 await page.locator('[data-memory-toc-toggle]').click();await tick();assert(await page.locator('.memory-toc').isHidden());
 const scroll=await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop);
 await page.locator('[data-memory-toc-toggle]').press('Enter');await tick();assert(await page.locator('.memory-toc').isVisible());
 await page.keyboard.press('Escape');await tick();assert(await page.locator('.memory-toc').isHidden());
 assert.equal(await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop),scroll);
 assert.equal(await page.locator('[data-memory-toc-toggle]').evaluate(el=>el===document.activeElement),true);
 session=await page.evaluate(()=>window.captureSessionState());await page.close();await open();
 await page.waitForFunction(()=>document.body.dataset.page==='memory');await tick();
 assert(await page.locator('.memory-toc').isHidden());assert(Math.abs(await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop)-scroll)<2);
 checks.push('keyboard collapse/expand/Escape and captured-session reload preserve body position and outline preference');
 await visiblePanel();await page.locator('.memory-toc a').nth(4).focus();await page.keyboard.press('Enter');await tick();assert.equal(await page.evaluate(()=>document.activeElement.id),links[4].slice(1));
 await page.locator('[data-memory-edit]').click();await page.locator('#memory-toc-enabled').uncheck();
 await page.locator('#memory-content').fill(source+'\n# 新增章节\n\n草稿');
 session=await page.evaluate(()=>window.captureSessionState());await page.close();await open();await page.locator('#memory-content').waitFor();
 assert(!(await page.locator('#memory-toc-enabled').isChecked()));assert((await page.locator('#memory-content').inputValue()).endsWith('草稿'));
 await page.locator('#memory-toc-enabled').check();await save();assert.equal(await page.locator('.memory-toc a').count(),31);
 assert.equal(store.snapshot().knowledge[0].content,source+'\n# 新增章节\n\n草稿');assert(store.exportBackup().knowledge[0].toc);
 checks.push('editor draft session, modified headings, exact Markdown and backup preference remain intact');
  const beforeRefresh=await page.locator('.memory-reading-scroll').evaluate(el=>{el.scrollTop=800;return el.scrollTop;});await tick();
  await page.locator('[data-memory-pin]').click();await tick();assert.equal(await page.locator('.memory-reading-scroll').evaluate(el=>el.scrollTop),beforeRefresh,'refreshing saved state must preserve the reading position');
 await page.locator('[data-memory-edit]').click();await page.locator('#memory-toc-enabled').uncheck();await save();assert.equal(await page.locator('.memory-toc').count(),0);
 await page.locator('[data-memory-edit]').click();await page.locator('#memory-toc-enabled').check();await page.locator('#memory-content').fill('无标题的正文');await save();await visiblePanel();assert.match(await page.locator('.memory-toc').textContent(),/添加.*标题/);
 await page.locator('[data-memory-edit]').click();await page.locator('#memory-content').fill('# <img src=x onerror="window.bad=1">\n\n[网页](https://example.com)\n\n## 中文');await save();await visiblePanel();
 assert.equal(await page.locator('.memory-body img,.memory-toc img').count(),0);assert.equal(await page.evaluate(()=>window.bad),undefined);
 await page.locator('.memory-toc a').last().click();assert.equal(external.length,0);await page.locator('.memory-body a').click();assert.deepEqual(external,['https://example.com']);
 checks.push('disabled and empty outlines, escaped titles and local/external link routing remain safe');
 await page.locator('[data-memory-edit]').click();await page.locator('#memory-content').fill(Array.from({length:70},(_,i)=>`## ${i+1} ${'非常长的标题'.repeat(10)}\n\n正文\n`).join('\n'));await save();await setSize(360,480);await visiblePanel();
 assert(await page.locator('.memory-toc ol').evaluate(el=>el.scrollHeight>el.clientHeight));await page.screenshot({path:path.join(out,'long-360.png')});
 assert.deepEqual(errors,[]);checks.push('long outline remains internally scrollable in a short narrow window; no page exceptions');
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,mode:'headless Chromium + real local UI and isolated Store; no native desktop interaction',data,checks},null,2));console.log('PASS '+checks.join('\nPASS '));
 }finally{await browser?.close();store.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
