// Real local renderer in headless Chromium; no Electron windows or databases.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), uiRoot = process.env.PLANEVERYDAY_UI_ROOT || root;
const output = path.join(root, 'test-results/gantt-view');
fs.mkdirSync(output, { recursive: true });
process.env.TEMP = process.env.TMP = path.join(output, 'temp');
fs.mkdirSync(process.env.TEMP, { recursive: true });
const checks = [], errors = [];
let browser, page;
const project = { id: 'p1', title: '<项目>学习', targetDate: '2026-12-18' };
const stages = [
  { id: 's1', projectId: 'p1', title: '基础学习', startDate: '2026-11-23', endDate: '2026-11-29', order: 1 },
  { id: 's2', projectId: 'p1', title: '练习与作品', startDate: '2026-11-28', endDate: '2026-12-05', order: 2 },
  { id: 's3', projectId: 'p1', title: '未排期阶段', startDate: null, endDate: null, order: 3 },
  { id: 's4', projectId: 'p1', title: '空阶段', startDate: null, endDate: null, order: 4 }
];
const tasks = [
  { id: 't1', projectId: 'p1', stageId: 's1', title: '字典练习', plannedDate: '2026-11-25', plannedEndDate: '2026-11-27', updatedAt: '2026-11-23T12:00:00Z', status: 'todo' },
  { id: 't2', projectId: 'p1', stageId: 's1', title: '已经完成', plannedDate: '2026-11-24', status: 'done' },
  { id: 't3', projectId: 'p1', stageId: 's1', title: '范围之外', plannedDate: '2026-12-08', plannedEndDate: '2026-12-10', status: 'todo' },
  { id: 't4', projectId: 'p1', stageId: 's3', title: '留待安排', plannedDate: null, status: 'todo' },
  { id: 't5', projectId: 'p1', stageId: null, title: '没有阶段', plannedDate: '2026-12-10', status: 'todo' },
  { id: 't6', projectId: 'p1', stageId: 's2', title: '<img src=x onerror=window.bad=1>', plannedDate: null, status: 'todo' },
  ...Array.from({ length: 24 }, (_, i) => ({ id: `extra${i}`, projectId: 'p1', stageId: 's2', title: `练习任务 ${i}`, plannedDate: null, status: 'todo' }))
];
const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const taskRange = () => page.evaluate(() => [data.tasks[0].plannedDate, data.tasks[0].plannedEndDate]);
async function render(input = {}) {
  await page.evaluate(({ project, stages, tasks, input }) => {
    window.cleanup?.(); window.failSave = false;
    window.calls = { tasks: [], stages: [], schedule: [], taskSchedule: [], cleanDuringSave: [], session: 0 };
    window.session = input.session || {};
    window.data = { project: input.project || project, stages: input.stages || stages, tasks: input.tasks || tasks };
    window.mountGantt = () => window.ProjectGantt.render({ container: document.querySelector('#test-root'),
      ...window.data, session: window.session,
      onTask: id => calls.tasks.push(id), onStage: id => calls.stages.push(id),
      onSchedule: proposal => calls.schedule.push(proposal), onSessionChange: () => calls.session++,
      onTaskSchedule: async proposal => {
        calls.taskSchedule.push(proposal); calls.cleanDuringSave.push(!session.taskDraft);
        if (window.failSave) throw new Error('模拟写入失败');
        const task = data.tasks.find(task => task.id === proposal.id);
        Object.assign(task, { plannedDate: proposal.startDate, plannedEndDate: proposal.endDate });
        cleanup(); cleanup = mountGantt();
      } });
    window.cleanup = mountGantt();
  }, { project, stages, tasks, input }); await tick();
}
async function drag(selector, delta, finish = 'release') {
  const control = page.locator(selector); await control.scrollIntoViewIfNeeded();
  // Keep ordinary drags clear of the sticky names and auto-scroll zone. The
  // stationary-pointer edge-scroll behavior has its own explicit test below.
  await control.evaluate(el=>{const viewport=el.closest('.gantt-viewport'),sheet=el.closest('.project-gantt');const left=viewport.getBoundingClientRect().left+parseFloat(getComputedStyle(sheet).getPropertyValue('--gantt-name-width'))+80;const x=el.getBoundingClientRect().left;if(x<left)viewport.scrollLeft-=left-x;});
  await tick();
  const rect = await control.boundingBox();
  const x = rect.x + Math.min(rect.width / 2, 35), y = rect.y + rect.height / 2;
  assert(await control.evaluate((el,{x,y})=>el.contains(document.elementFromPoint(x,y)),{x,y}),'drag handle must receive pointer hit');
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + delta, y, { steps: 4 });
  assert.equal(await page.evaluate(() => calls.schedule.length + calls.taskSchedule.length), 0, 'pointer motion must not submit');
  if (finish === 'escape') await page.keyboard.press('Escape');
  if (finish === 'cancel') await control.dispatchEvent('pointercancel');
  if (finish === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  if (finish === 'hidden') await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;
  });
  await page.mouse.up(); await tick();
}
async function formRange(start, end) {
  await page.locator('.gantt-inspector [name=startDate]').fill(start);
  await page.locator('.gantt-inspector [name=endDate]').fill(end);
}
(async () => {
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><main id="test-root"></main></body></html>');
    await page.addStyleTag({ path: path.join(uiRoot, 'src/ui/styles.css') });
    await page.addStyleTag({ path: path.join(uiRoot, 'src/ui/gantt.css') });
    await page.addStyleTag({ content: '#test-root{height:calc(100vh - 32px);width:calc(100vw - 32px);margin:16px;display:flex;min-height:0;min-width:0}' });
    await page.addScriptTag({ path: path.join(uiRoot, 'src/ui/gantt.js') });
    await render();
    assert.equal(await page.locator('[data-task-id="t1"]').count(), 1, 'stages expanded initially');
    const dates = await page.locator('.gantt-date-cell').evaluateAll(cells => cells.map(c => ({ date: c.dataset.date, width: c.getBoundingClientRect().width, weekday: c.querySelector('small')?.textContent })));
    assert(dates.length >= 28 && dates.length <= 366);
    dates.forEach((d, i) => { assert.equal(d.width, 48); assert(d.weekday); if (i) assert.equal(Date.parse(d.date) - Date.parse(dates[i - 1].date), 86400000); });
    assert(await page.locator('.gantt-month').count() >= 2);
    assert.equal(await page.locator('.gantt-reference').count(),0,'date markers must not cut vertically through task rows');
    assert.equal(await page.locator('.gantt-date-cell.is-today[aria-current="date"]').count(),1);
    assert.equal(await page.locator(`.gantt-date-cell.is-target[data-date="${project.targetDate}"]`).count(),1);
    await page.locator('.gantt-density').click();
    assert.equal(await page.locator('.gantt-date-cell').count(), dates.length);
    assert.equal(await page.locator('.gantt-date-cell').first().evaluate(e => e.getBoundingClientRect().width), 44);
    await page.locator('[data-stage-toggle="s1"]').click();
    assert.equal(await page.locator('[data-task-id="t1"]').count(), 0);
    await page.locator('[data-stage-toggle="s1"]').click();
    assert.equal(await page.locator('[data-task-id="t1"]').count(), 1);
    checks.push('expanded daily sheet, continuous date/weekday cells, merged month groups, both densities remain daily, collapse is explicit');

    await render();
    const alignment = await page.evaluate(() => {
      const cell = document.querySelector('[data-date="2026-11-25"]').getBoundingClientRect(), bar = document.querySelector('[data-task-bar=t1]').getBoundingClientRect();
      return { left: bar.left - cell.left, width: bar.width, height: bar.height };
    });
    assert.deepEqual(alignment, { left: 3, width: 138, height: 30 });
    assert.equal(await page.locator('[data-task-bar=t2]').evaluate(e => e.getBoundingClientRect().width), 42, 'legacy day falls back to one day');
    assert.equal(await page.locator('.gantt-outlier-note').count(), 1);
    assert.equal(await page.locator('[data-task-id=t4] .gantt-bar').count(), 0);
    assert.match(await page.locator('[data-task-id=t4]').textContent(), /未安排/);
    assert.match(await page.locator('[data-task-id=t2]').textContent(), /✓/);
    assert.equal(await page.locator('#test-root img').count(), 0);
    await page.locator('[data-task-id=t1] .gantt-name-button').click();
    assert.equal(await page.locator('.gantt-inspector [name=endDate]').inputValue(), '2026-11-27');
    await page.locator('[data-task-bar=t1] .gantt-bar-move').hover();
    const hover=await page.locator('[data-task-bar=t1] .gantt-bar-move').evaluate(el=>({background:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color,bar:getComputedStyle(el.parentElement).backgroundColor}));
    assert.deepEqual(hover,{background:'rgba(0, 0, 0, 0)',ink:'rgb(255, 255, 255)',bar:'rgb(45, 81, 57)'},'hover must not place white selected text over the generic pale button fill');
    await page.locator('.gantt-details').click(); assert.deepEqual(await page.evaluate(() => calls.tasks), ['t1']);
    checks.push('inclusive three-day bar matches grid pixels, old one-day fallback, completed/undated/outside states and escaped titles');

    for (const [mode, delta, range] of [
      ['move', 96, ['2026-11-27', '2026-11-29']], ['start', 48, ['2026-11-26', '2026-11-27']],
      ['end', 96, ['2026-11-25', '2026-11-29']], ['start', 192, ['2026-11-27', '2026-11-27']],
      ['end', -192, ['2026-11-25', '2026-11-25']]
    ]) {
      await render(); await drag(`[data-task-bar=t1] .gantt-bar-${mode}`, delta); assert.deepEqual(await taskRange(), range, mode);
      const save = await page.evaluate(() => calls.taskSchedule[0]);
      assert.deepEqual(save.expected, { plannedDate: '2026-11-25', plannedEndDate: '2026-11-27', updatedAt: '2026-11-23T12:00:00Z' });
      assert.equal(await page.evaluate(() => session.selectedTaskId), 't1');
      assert.equal(await page.evaluate(() => calls.cleanDuringSave.every(Boolean)), true);
    }
    checks.push('task body drag preserves duration, both edges resize, endpoints clamp to one day, save carries original concurrency token');

    for (const mode of ['escape', 'cancel', 'blur', 'hidden']) {
      await render(); await drag('[data-task-bar=t1] .gantt-bar-move', 96, mode);
      assert.deepEqual(await taskRange(), ['2026-11-25', '2026-11-27']);
      assert.equal(await page.evaluate(() => calls.taskSchedule.length), 0);
      assert.equal(await page.locator('.is-dragging').count(), 0);
    }
    await render(); await drag('[data-task-bar=t1] .gantt-bar-move', 3);
    assert.equal(await page.evaluate(() => calls.taskSchedule.length), 0);
    checks.push('movement threshold, Escape, pointer cancellation, blur and hidden window all cancel without writes');

    await render(); await page.evaluate(() => { failSave = true; });
    await drag('[data-task-bar=t1] .gantt-bar-move', 96);
    assert.deepEqual(await taskRange(), ['2026-11-25', '2026-11-27']);
    assert.equal(await page.locator('.gantt-inspector [name=startDate]').inputValue(), '2026-11-27');
    assert.match(await page.locator('.gantt-feedback').textContent(), /失败.*保留/);
    const draft = await page.evaluate(() => session.taskDraft);
    await page.evaluate(() => { cleanup(); cleanup = mountGantt(); }); await tick();
    assert.deepEqual(await page.evaluate(() => session.taskDraft), draft);
    assert.equal(await page.locator('.gantt-inspector [name=endDate]').inputValue(), '2026-11-29');
    await page.evaluate(() => { failSave = false; }); await page.locator('.gantt-apply').click(); await tick();
    assert.deepEqual(await taskRange(), ['2026-11-27', '2026-11-29']);
    assert.equal(await page.evaluate(() => session.taskDraft == null), true);
    checks.push('rejected Promise restores original bar and retains exact candidate/selection through renderer replacement; retry persists once');

    await render(); await page.locator('[data-task-id=t1] .gantt-name-button').click();
    await formRange('2026-12-30', '2027-01-03');
    await page.locator('.gantt-apply').click(); await tick(); assert.deepEqual(await taskRange(), ['2026-12-30', '2027-01-03']);
    await formRange('2027-02-10', '2027-02-09'); await page.locator('.gantt-apply').click();
    assert.equal(await page.evaluate(() => calls.taskSchedule.length), 1); assert.match(await page.locator('.gantt-feedback').textContent(), /不能早于/);
    await render(); await page.locator('[data-task-bar=t1] .gantt-bar-start').focus(); await page.keyboard.press('ArrowLeft'); await tick();
    assert.deepEqual(await taskRange(), ['2026-11-24', '2026-11-27']);
    await page.keyboard.press('ArrowLeft'); await tick();
    assert.deepEqual(await taskRange(), ['2026-11-23', '2026-11-27'], 'keyboard remains on the edited endpoint after parent refresh');
    checks.push('date form handles cross-month/year ranges, rejects reversed dates, keyboard endpoint adjustment is equivalent');

    await render(); await page.locator('[data-task-id=t1] .gantt-name-button').click();
    await formRange('2026-12-01', '2026-12-03');
    await page.evaluate(() => { Object.assign(data.tasks[0], {plannedDate:'2026-12-05',plannedEndDate:'2026-12-08',updatedAt:'newer'}); cleanup(); cleanup=mountGantt(); });
    await page.locator('.gantt-discard').click();
    assert.equal(await page.locator('.gantt-inspector [name=startDate]').inputValue(), '2026-12-05');
    await formRange('2026-12-06', '2026-12-09'); await page.locator('.gantt-apply').click(); await tick();
    assert.equal(await page.evaluate(() => calls.taskSchedule[0].expected.updatedAt), 'newer');
    checks.push('explicit restore-saved action discards a stale candidate and uses the latest date conflict token for the next save');

    await render(); await drag('[data-stage-bar=s1] .gantt-bar-move', 96);
    assert.deepEqual(await page.evaluate(() => calls.schedule), [{ id: 's1', startDate: '2026-11-25', endDate: '2026-12-01' }]);
    assert.equal(await page.evaluate(() => data.stages[0].startDate), '2026-11-23');
    assert.deepEqual(await page.evaluate(() => calls.stages), []);
    await render(); await drag('[data-stage-bar=s1] .gantt-bar-start', 48);
    assert.deepEqual(await page.evaluate(() => calls.schedule), [{ id: 's1', startDate: '2026-11-24', endDate: '2026-11-29' }]);
    checks.push('phase body and start handle retain explicit impact-preview callback without mutation or accidental editor click');

    await page.setViewportSize({ width: 760, height: 600 }); await render();
    const edgeControl = page.locator('[data-task-bar=t1] .gantt-bar-move'); await edgeControl.scrollIntoViewIfNeeded();
    const rect = await edgeControl.boundingBox(), view = await page.locator('.gantt-viewport').boundingBox();
    await page.mouse.move(rect.x + 15, rect.y + 12); await page.mouse.down();
    await page.mouse.move(view.x + view.width - 4, rect.y + 12, { steps: 4 });
    const left = await page.locator('.gantt-viewport').evaluate(e => e.scrollLeft);
    await page.waitForTimeout(180);
    const moved = await page.locator('.gantt-viewport').evaluate(e => e.scrollLeft); assert(moved > left, 'edge drag scrolls while pointer stays still');
    await page.keyboard.press('Escape'); await page.mouse.up();
    const cancelled = await page.locator('.gantt-viewport').evaluate(e => e.scrollLeft); await page.waitForTimeout(100);
    assert.equal(await page.locator('.gantt-viewport').evaluate(e => e.scrollLeft), cancelled);
    assert.equal(await page.evaluate(() => calls.taskSchedule.length), 0);
    checks.push('drag edge auto-scroll advances with stationary pointer and stops on cancellation without idle scrolling');

    for (const [width, height] of [[360, 480], [460, 680], [1280, 850]]) {
      await page.setViewportSize({ width, height }); await render();
      await page.locator('[data-task-id=t1] .gantt-name-button').click();
      await page.locator('.gantt-viewport').evaluate(e => { e.scrollTop = 500; e.scrollLeft = 350; }); await tick();
      const geometry = await page.evaluate(() => {
        const v = document.querySelector('.gantt-viewport').getBoundingClientRect(), h = document.querySelector('.gantt-header').getBoundingClientRect();
        const row = [...document.querySelectorAll('.gantt-task-row')].find(row => { const r = row.getBoundingClientRect(); return r.top >= h.bottom && r.bottom <= v.bottom; });
        const name = row.querySelector('.gantt-name').getBoundingClientRect(), track = row.querySelector('.gantt-track').getBoundingClientRect();
        const fields = [...document.querySelectorAll('.gantt-inspector input')].map(i => i.getBoundingClientRect());
        return { overflow: document.documentElement.scrollWidth > innerWidth, aligned: Math.abs(name.top - track.top) < 1,
          nameLeft: name.left, viewportLeft: v.left, headerTop: h.top, viewportTop: v.top, height: v.height,
          fieldsFit: fields.every(r => r.right <= innerWidth && r.bottom <= innerHeight) };
      });
      assert(!geometry.overflow && geometry.aligned && geometry.height >= 120 && geometry.fieldsFit, JSON.stringify({ width, ...geometry }));
      assert(Math.abs(geometry.nameLeft - geometry.viewportLeft) <= 2 && Math.abs(geometry.headerTop - geometry.viewportTop) <= 2);
      await page.screenshot({ path: path.join(output, `gantt-${width}.png`) });
    }
    const saved = await page.evaluate(() => ({ left: session.scrollLeft, top: session.scrollTop }));
    await page.evaluate(() => { cleanup(); cleanup = mountGantt(); }); await tick();
    assert.deepEqual(await page.locator('.gantt-viewport').evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop })), saved);
    checks.push('360×480, 460×680, wide geometry: sticky names/header share rows, internal scrolling, selected inspector fits and scroll restores');

    await render({ project: { ...project, targetDate: '9999-12-31' }, tasks: [...tasks,
      { id: 'far', projectId: 'p1', stageId: 's1', title: '遥远日期', plannedDate: '0001-01-01', plannedEndDate: '0001-01-03', status: 'todo' }] });
    assert.equal(await page.locator('.gantt-date-cell').count(), 366);
    assert.match(await page.locator('.gantt-full-range').textContent(), /0001-01-01.*9999-12-31/);
    await page.locator('[data-task-id=far] .gantt-outside').click(); await tick();
    assert.equal(await page.locator('[data-task-bar=far]').count(), 1);
    await page.locator('.gantt-target-button').click(); await tick();
    assert.equal(await page.locator('[data-date="9999-12-31"]').count(), 1);
    await page.locator('.gantt-today-button').click(); await tick();
    assert.equal(await page.locator('.gantt-date-cell.is-today').count(), 1);
    checks.push('0001–9999 data stays bounded at 366 columns; remote tasks, target and today remain directly reachable');

    await page.setViewportSize({width:360,height:480});
    const futureDay=await page.evaluate(()=>{const d=new Date();d.setFullYear(d.getFullYear()+2);return `${d.getFullYear()}-06-15`;});
    const futureTask={...tasks[0],stageId:null,plannedDate:futureDay,plannedEndDate:futureDay};
    await render({project:{...project,targetDate:null},stages:[],tasks:[futureTask]});
    const initial=await page.locator('[data-task-bar=t1]').evaluate(el=>{const bar=el.getBoundingClientRect(),v=el.closest('.gantt-viewport').getBoundingClientRect(),sheet=el.closest('.project-gantt');return {bar:bar.left,view:v.left+parseFloat(getComputedStyle(sheet).getPropertyValue('--gantt-name-width')),right:v.right};});
    assert(initial.bar>=initial.view&&initial.bar<initial.right,'future project opens on its planned task, not an empty present-day grid');
    await page.locator('.gantt-viewport').evaluate(el=>el.scrollLeft+=48);await tick();const remembered=await page.evaluate(()=>session.scrollLeft);await page.evaluate(()=>{cleanup();cleanup=mountGantt();});await tick();assert.equal(await page.locator('.gantt-viewport').evaluate(el=>el.scrollLeft),remembered);
    checks.push('fresh future project anchors on scheduled work while renderer replacement keeps the user scroll position');

    await render({ project: { ...project, targetDate: null }, stages: stages.map(s => ({ ...s, startDate: null, endDate: null })), tasks: tasks.map(t => ({ ...t, plannedDate: null, plannedEndDate: null })) });
    assert.equal(await page.locator('.gantt-bar').count(), 0);
    assert(await page.locator('.gantt-date-cell').count() >= 28);
    await page.locator('[data-task-id=t1] .gantt-unscheduled').click(); await formRange('2026-12-01', '2026-12-01'); await page.locator('.gantt-apply').click(); await tick();
    assert.deepEqual(await taskRange(), ['2026-12-01', '2026-12-01']);
    assert.deepEqual(errors, []);
    checks.push('undated tasks have no fabricated bars and can receive their first inclusive range; no page exceptions');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, mode: 'headless Chromium, pure renderer fixture, no desktop control or database', checks }, null, 2));
    console.log(checks.map(c => `PASS ${c}`).join('\n'));
  } finally { await browser?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
