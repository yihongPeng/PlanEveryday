// Headless fallback renderer only; never opens the native desktop pet or sends OS input.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/pet-double-click');
fs.mkdirSync(out,{recursive:true});process.env.TEMP=process.env.TMP=path.join(out,'temp');fs.mkdirSync(process.env.TEMP,{recursive:true});
(async()=>{let browser;try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:300,height:250}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.petCommands=[];window.planner={pet:action=>petCommands.push(action),onChange(){},invoke:async()=>({ok:true,data:{tasks:[],events:[]}})};});
 const source=process.env.PLANEVERYDAY_SOURCE_ROOT||root;
 await page.goto(pathToFileURL(path.join(source,'src/ui/pet.html')).href);
 const actions=()=>page.evaluate(()=>petCommands.filter(c=>['open','toggleSize'].includes(c)));
 await page.mouse.dblclick(58,80,{delay:70});assert.deepEqual(await actions(),['open','toggleSize']);
 await page.mouse.dblclick(58,80,{delay:70});assert.deepEqual(await actions(),['open','toggleSize','open','toggleSize']);
 await page.evaluate(()=>petCommands.length=0);
 await page.mouse.move(58,80);await page.mouse.down();await page.mouse.move(90,80,{steps:4});await page.mouse.up();assert.deepEqual(await actions(),[]);
 await page.mouse.click(58,80);assert.deepEqual(await actions(),['open']);
 await page.evaluate(()=>petCommands.length=0);
 await page.mouse.move(58,80);await page.mouse.down({clickCount:2});await page.mouse.move(90,80,{steps:4});await page.mouse.up({clickCount:2});assert.deepEqual(await actions(),[]);
 await page.mouse.click(58,80,{button:'right'});await page.mouse.click(58,80);assert.deepEqual(await actions(),['open']);
 assert.deepEqual(errors,[]);const result={headless:true,checks:['two double-click pairs','drag without opening','second-click drag without toggling','right-click resets pair'],pageErrors:errors};
 fs.writeFileSync(path.join(out,'renderer-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
