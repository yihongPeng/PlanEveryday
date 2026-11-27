// Public documentation captures: real renderer, synthetic data, headless only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const work = path.join(root, 'test-results', 'readme-screenshots');
const output = path.join(root, 'docs', 'images');
fs.mkdirSync(work, {recursive:true});
fs.mkdirSync(output, {recursive:true});
process.env.TEMP = process.env.TMP = path.join(work, 'temp');
fs.mkdirSync(process.env.TEMP, {recursive:true});
const {chromium} = require('playwright');
const sourceRoot = process.env.PLANEVERYDAY_UI_ROOT || root;
const {Store} = require(path.join(sourceRoot, 'src/store.cjs'));
const store = new Store(path.join(fs.mkdtempSync(path.join(work, 'sample-')), 'planner.sqlite'));
const date = (offset=0) => {
  const day = new Date(); day.setDate(day.getDate()+offset);
  return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
};
const project = store.addProject({title:'学会 Python，完成一个小工具',targetDate:date(15)});
const stage = store.addStage({projectId:project.id,title:'基础学习',startDate:date(-2),endDate:date(4)});
const next = store.addStage({projectId:project.id,title:'练习与作品',startDate:date(3),endDate:date(12)});
const final = store.addStage({projectId:project.id,title:'整理与复盘'});
const completed = store.addTask({title:'读懂列表与字典',projectId:project.id,stageId:stage.id,plannedDate:date(-2),plannedEndDate:date(2)});
store.updateTask(completed.id,{status:'done'});
const selected = store.addTask({title:'写三个字典练习',projectId:project.id,stageId:stage.id,plannedDate:date(-1),plannedEndDate:date(3),priority:'important'});
store.toggleFocus(selected.id);
store.addTask({title:'整理函数笔记',projectId:project.id,stageId:stage.id,plannedDate:date(1),plannedEndDate:date(4)});
store.addTask({title:'做一个命令行练习',projectId:project.id,stageId:next.id,plannedDate:date(3),plannedEndDate:date(6)});
store.addTask({title:'写一份简短的使用说明',projectId:project.id,stageId:next.id,plannedDate:date(8),plannedEndDate:date(11)});
store.addTask({title:'记录这次项目的收获',projectId:project.id,stageId:final.id});
const reading = store.addTask({title:'阅读 20 页，记下一个新想法',plannedDate:date()});
store.toggleFocus(reading.id);
store.addTask({title:'复习本周的英语单词',plannedDate:date()});
store.addTask({title:'整理书桌与下载文件夹',plannedDate:date()});
store.addKnowledge({title:'Python：字典与列表',tags:['Python','基础知识'],toc:true,content:[
  '# 字典与列表','两种常用的数据结构：列表保存有序元素，字典通过键查找对应的值。',
  '## 列表：按顺序保存','用方括号创建列表，通过下标访问元素。适合保存阅读清单、练习记录等有顺序的内容。',
  '```python\nbooks = ["Python 入门", "数据结构"]\nbooks.append("小项目练习")\nprint(books[0])\n```',
  '## 字典：通过键查找','每个键对应一个值。读取不确定是否存在的键时，可以使用 `get()` 提供默认值。',
  '```python\nprogress = {"阅读": 20, "练习": 3}\nprint(progress.get("复习", 0))\n```',
  '## 怎么选择','| 需要做什么 | 选择 |\n| --- | --- |\n| 按位置访问、保留顺序 | 列表 |\n| 根据名称快速查找 | 字典 |',
  '## 复习时问自己','- 能否不看笔记，创建一个列表和一个字典？\n- 如何追加元素？\n- 当键不存在时，如何给出默认值？'
].join('\n\n')});
let browser;
(async()=>{try{
  browser = await chromium.launch({channel:'msedge',headless:true});
  const page = await browser.newPage({viewport:{width:1320,height:850},deviceScaleFactor:1});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('sampleSnapshot',()=>({...store.snapshot(),version:require('../package.json').version}));
  await page.addInitScript(()=>{window.planner={invoke:async action=>action==='snapshot'?{ok:true,data:await window.sampleSnapshot()}:{ok:true,data:null},onChange(){},onUpdate(){},onOpenTask(){}};});
  await page.goto(pathToFileURL(path.join(sourceRoot,'src/ui/index.html')).href);
  await page.locator('.task-title').first().waitFor();
  const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await tick(); await page.screenshot({path:path.join(output,'today.png')});
  await page.locator('[data-view=projects]:visible').first().click();
  await page.locator('[data-project-open]').first().click();
   await tick();
  await page.locator(`[data-task-id="${selected.id}"] .sheet-name`).click();
  await page.locator('.gantt-viewport').evaluate((el,day)=>{
    const cell=el.querySelector(`[data-date="${day}"]`);
    el.scrollLeft+=cell.getBoundingClientRect().left-el.getBoundingClientRect().left-parseFloat(getComputedStyle(el.closest('.project-gantt')).getPropertyValue('--gantt-name-width'))-1;
  },date(-2));
  await page.mouse.move(5,5);await tick();
  assert.equal(await page.locator('.gantt-reference').count(),0);
  await page.screenshot({path:path.join(output,'gantt.png')});
  await page.locator('[data-view=memory]:visible').first().click();
  await page.locator('[data-memory-open]').first().click();await tick();
  assert(await page.locator('.memory-toc').isVisible());
  await page.screenshot({path:path.join(output,'memory.png')});
  assert.deepEqual(errors,[]);
  console.log('Created 3 README screenshots from the actual UI using synthetic data only.');
}finally{await browser?.close();store.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
