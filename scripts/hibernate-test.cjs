const {testDirectory}=require('../tests/test-paths.cjs');
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),data=testDirectory('yaya-hibernate-');
(async()=>{const app=await electron.launch({args:[root],env:{...process.env,PLANEVERYDAY_DATA_DIR:data,PLANEVERYDAY_SUSPEND_MS:'500'}});try{
 await app.firstWindow();let page;for(let i=0;i<30;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 await page.locator('#quick-title').fill('休眠后应保留的输入');await page.locator('#hide').click();await new Promise(r=>setTimeout(r,1400));
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('index.html')).length),0,'hidden plan renderer must be released');
 await app.evaluate(({app})=>app.emit('second-instance',{},[]));
 for(let i=0;i<30;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 await page.locator('#quick-title').waitFor();await page.waitForFunction(()=>document.querySelector('#quick-title').value==='休眠后应保留的输入');
 await page.evaluate(()=>{const capture=window.captureSessionState;window.captureSessionState=()=>({...capture(),captureDay:'2020-01-01',quickDate:'2020-01-01',day:'2020-01-01'});});await page.locator('#hide').click();await new Promise(r=>setTimeout(r,1400));await app.evaluate(({app})=>app.emit('second-instance',{},[]));for(let i=0;i<30;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}await page.locator('#quick-title').waitFor();await page.waitForFunction(()=>document.querySelector('#quick-title').value==='休眠后应保留的输入');assert.notEqual(await page.locator('#quick-date').inputValue(),'2020-01-01','reopen after midnight must not keep default yesterday');
 console.log('PASS hidden renderer released and draft restored');
}finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
