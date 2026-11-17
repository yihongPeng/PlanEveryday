const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const label=process.env.PROFILE_LABEL||'current';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'yaya-profile-'));
const executablePath=process.env.PLANEVERYDAY_EXE||require('electron');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let app;
function sample(rootPid){
 const script=`$all=Get-CimInstance Win32_Process; $ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${rootPid}); do {$count=$ids.Count; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}while($count -ne $ids.Count); @(Get-Process -Id @($ids) -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64,CPU) | ConvertTo-Json -Compress`;
 const list=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true}));
 return {processes:list,workingSetMB:list.reduce((a,p)=>a+p.WorkingSet64,0)/1048576,privateMB:list.reduce((a,p)=>a+p.PrivateMemorySize64,0)/1048576,cpuSeconds:list.reduce((a,p)=>a+p.CPU,0)};
}
(async()=>{try{
 const started=Date.now();app=await electron.launch({executablePath,args:process.env.PLANEVERYDAY_EXE?[]:[root],env:{...process.env,PLANEVERYDAY_DATA_DIR:data}});
 let page=await app.firstWindow();for(let i=0;i<50;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));if(page)break;await pause(100);}
 await page.locator('#quick-title').waitFor();const startupMs=Date.now()-started;
 const pid=app.process().pid;await pause(3000);const shown=sample(pid);
 await page.evaluate(()=>window.planner.invoke('settings',{doNotDisturb:true}));
 await page.locator('#quick-title').fill('性能测试的未保存草稿');await page.locator('#hide').click();
 const hideStart=sample(pid);await pause(60000);const hidden=sample(pid);
 const cpuPercent=hidden.processes.reduce((total,p)=>total+Math.max(0,p.CPU-(hideStart.processes.find(old=>old.Id===p.Id)?.CPU||0)),0)/60/os.cpus().length*100;
 const report={label,executablePath,startupMs,shown,hidden,idleCpuPercent:cpuPercent,sampleSeconds:60};
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,`test-results/memory-${label}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1});
