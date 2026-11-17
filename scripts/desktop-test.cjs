const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results'); fs.mkdirSync(results, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planeveryday-test-'));
const executablePath = process.env.PLANEVERYDAY_EXE || require('electron');
const launch = () => electron.launch({ executablePath, args: process.env.PLANEVERYDAY_EXE ? [] : [root], env: { ...process.env, PLANEVERYDAY_DATA_DIR: dataDir }, timeout: 30000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let app;
const report = [];
async function check(label, fn) { await fn(); report.push(label); console.log('PASS', label); }
async function mainPage(app) { await app.firstWindow(); for(let i=0;i<40;i++){ const p=app.windows().find(w=>w.url().endsWith('index.html')); if(p) { await p.locator('#quick-title').waitFor(); return p; } await sleep(100); } throw Error('Main window missing'); }
(async () => {
 try {
  const start = Date.now(); app = await launch(); let page = await mainPage(app);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('#subtitle').filter({hasText:'星期'}).waitFor();
  report.push(`Startup ${Date.now()-start} ms`);
  await check('one browser renderer, native pet process, main interactive', async () => {
   const wins = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),transparent:w.isVisible(),bounds:w.getBounds()})));
   assert.equal(wins.length,1); const state=await page.evaluate(()=>window.planner.invoke('snapshot'));assert.equal(state.data.pet.native,true);assert.ok(state.data.pet.pid);
  });
  await page.screenshot({path:path.join(results,'01-small-empty.png')});
  await check('create, focus, edit, search, complete and reopen', async () => {
   for (const title of ['整理这周的学习计划','读 20 页喜欢的书','留一点时间散步']) { await page.locator('#quick-title').fill(title); await page.locator('#quick-title').press('Enter'); await page.getByText(title,{exact:true}).waitFor(); }
   await page.locator('[data-focus]').first().click(); await page.locator('.is-focus').waitFor();
   await page.getByText('整理这周的学习计划',{exact:true}).click();
   await page.locator('[name=notes]').fill('把目标拆成小步骤，先从最重要的一件事开始。');
   await page.getByRole('button',{name:'保存修改',exact:true}).click(); await page.getByText('修改已保存',{exact:true}).waitFor(); await page.locator('#detail-close').click();
   await page.locator('#search').fill('学习'); assert.equal(await page.locator('.task-row').count(),1); await page.locator('#search').fill('');
   await page.locator('[data-complete]').first().click(); await page.locator('details').locator('summary').waitFor();
   await page.locator('details').locator('summary').click(); await page.locator('.is-done [data-complete]').click(); await page.locator('.is-done').waitFor({state:'detached'});
  });
  await page.locator('#content').evaluate(el=>el.scrollTop=0); await page.screenshot({path:path.join(results,'02-small-tasks.png')});
  await check('maximize and restore preserves input and selection', async () => {
   await page.locator('#quick-title').fill('尚未保存的想法');
   await page.locator('#maximize').click(); await sleep(350);
   assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isMaximized()));
   assert.equal(await page.locator('#quick-title').inputValue(),'尚未保存的想法');
   await page.screenshot({path:path.join(results,'03-full-tasks.png')});
   await page.getByText('读 20 页喜欢的书',{exact:true}).click(); await page.screenshot({path:path.join(results,'04-full-detail.png')}); await page.locator('#detail-close').click();
   await page.locator('#maximize').click(); await sleep(200); assert.equal(await page.locator('#quick-title').inputValue(),'尚未保存的想法'); await page.locator('#quick-title').fill('');
  });
  await check('schedule tomorrow, undo, inbox, seven-day planner', async () => {
   await page.locator('.task-main').first().click();
   await page.locator('[name=notes]').fill('撤销日期时保留这份编辑草稿');
   const originalDate = await page.locator('[name=plannedDate]').inputValue();
   await page.locator('#detail-close').click();
   await page.locator('[data-date]').first().click(); await page.locator('[data-schedule=tomorrow]').click(); await page.locator('#toast button').click();
   await page.locator('.task-main').first().click();
   assert.equal(await page.locator('[name=plannedDate]').inputValue(),originalDate,'Undo must refresh editor date');
   assert.equal(await page.locator('[name=notes]').inputValue(),'撤销日期时保留这份编辑草稿');
   await page.locator('#detail-close').click();
   assert.equal(await page.locator('.task-row').count(),3);
   await page.locator('.mobile-nav [data-view=inbox]').click();
   await page.locator('#quick-title').fill('开始一个小小的新项目'); await page.locator('#quick-title').press('Enter'); await page.getByText('开始一个小小的新项目',{exact:true}).waitFor();
   await page.locator('.mobile-nav [data-view=future]').click(); await page.locator('#week-select').selectOption({index:2}); await page.locator('[data-assign]').click();
   await page.locator('[data-assign]').waitFor({state:'detached'});
   await page.screenshot({path:path.join(results,'05-week-small.png')});
  });
  await check('settings persist and close hides without destroying windows', async () => {
   await page.locator('.mobile-nav [data-view=settings]').click(); await page.locator('[data-setting=doNotDisturb]').check();
   await page.locator('#hide').click();
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isVisible()),false);
   await app.evaluate(({app})=>app.emit('second-instance',{},[]));
   await sleep(200); assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isVisible()),true);
  });
  await check('no layout overflow at 360, 460, 900 and 1400 logical widths', async () => {
   for(const width of [360,460,900,1400]) {
    await app.evaluate(({BrowserWindow,screen}, width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).setBounds({width,height:Math.min(800,screen.getPrimaryDisplay().workArea.height)}),width);
    await sleep(100);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
   }
  });
  assert.deepEqual(errors,[]);
  await app.close(); app = await launch(); page = await mainPage(app);
  await check('persist tasks and preferences across process restart', async () => {
   const result = await page.evaluate(()=>window.planner.invoke('snapshot'));
   assert.equal(result.data.tasks.length,4); assert.equal(result.data.settings.doNotDisturb,true);
   assert.equal(result.data.tasks.find(t=>t.title==='整理这周的学习计划').notes,'把目标拆成小步骤，先从最重要的一件事开始。');
  });
  fs.writeFileSync(path.join(results,'desktop-report.json'),JSON.stringify({executablePath,dataDir,checks:report,passed:true},null,2));
 } finally { if(app) await app.close(); }
})().catch(e=>{console.error(e); fs.writeFileSync(path.join(results,'desktop-failure.txt'),String(e.stack)); process.exitCode=1;});
