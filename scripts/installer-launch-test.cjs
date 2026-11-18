// Real NSIS post-upgrade launch regression, using a harmless executable that
// records its own path. All files and both test shortcuts stay below test-results.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const version=require('../package.json').version;
const fixture=path.join(root,'test-results','installer-launch-qa');
const app=path.join(fixture,'app');
const data=path.join(fixture,'data');
const setup=path.join(root,'release',version,'installer-qa-launch-probe',`PlanEveryday-Setup-${version}.exe`);
const links={desktop:path.join(data,'shortcut-test','desktop','PlanEveryday launch QA.lnk'),start:path.join(data,'shortcut-test','start-menu','PlanEveryday launch QA.lnk')};
const launchLog=path.join(data,'launches.tsv');
const report=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function run(file,args,cwd=root){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,cwd,stdio:'ignore'});child.on('error',reject);child.on('exit',resolve);});}
function record(result){report.push(result);fs.writeFileSync(path.join(fixture,'launch-test-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(result));}
function shortcut(action,file,target=''){
 const ps=path.join(fixture,'shortcut.ps1');
 fs.writeFileSync(ps,`param([string]$action,[string]$file,[string]$target)\n$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($file)\nif($action -eq 'write'){$shortcut.TargetPath=$target;$shortcut.WorkingDirectory=Split-Path $target;$shortcut.IconLocation=$target+',0';$shortcut.Save()}else{Write-Output $shortcut.TargetPath}\n`);
 return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',ps,action,file,target],{windowsHide:true,encoding:'utf8',env:{...process.env,TEMP:path.join(data,'installer-temp'),TMP:path.join(data,'installer-temp')}}).trim();
}
async function upgrade(scenario){
 fs.writeFileSync(launchLog,'');
 assert.equal(await run(setup,['/S','--updated','--force-run'],app),0);
 let lines=[];for(let i=0;i<100;i++){lines=fs.readFileSync(launchLog,'utf8').trim().split(/\r?\n/).filter(Boolean);if(lines.length)break;await sleep(100);}
 const fields=lines.at(-1)?.split('\t')||[];
 const result={scenario,launchedPath:fields[0],args:fields[1],cwd:fields[2],expectedPath:path.join(app,'PlanEveryday.exe'),passed:fields[0]===path.join(app,'PlanEveryday.exe')&&fields[1]==='--updated'};
 record(result);assert(result.passed,'Post-upgrade launch must use the installed executable directly');
}
async function main(){
 fs.mkdirSync(fixture,{recursive:true});
 for(const link of Object.values(links))fs.mkdirSync(path.dirname(link),{recursive:true});
 execFileSync(process.execPath,[path.join(__dirname,'installer.cjs'),'--qa','--qa-launch-probe','--skip-package'],{stdio:'inherit',windowsHide:true});
 assert.equal(await run(setup,['/S']),0);
 const portable=path.join(fixture,'stale-portable');fs.mkdirSync(portable,{recursive:true});
 const wrongExe=path.join(portable,'PlanEveryday.exe');fs.copyFileSync(path.join(app,'PlanEveryday.exe'),wrongExe);
 for(const link of Object.values(links))shortcut('write',link,wrongExe);
 await upgrade('Existing stale shortcuts must not choose the post-upgrade executable');
 for(const link of Object.values(links))assert.equal(shortcut('read',link),path.join(app,'PlanEveryday.exe'));
 record({scenario:'Existing owned Desktop and Start-menu shortcuts retargeted',passed:true});
 fs.unlinkSync(links.desktop);shortcut('write',links.start,wrongExe);
 await upgrade('Deleted desktop shortcut stays deleted while existing Start-menu shortcut repairs');
 assert(!fs.existsSync(links.desktop));assert.equal(shortcut('read',links.start),path.join(app,'PlanEveryday.exe'));
 fs.unlinkSync(links.start);
 await upgrade('Post-upgrade launch works when both owned shortcuts were deleted');
 assert(!fs.existsSync(links.desktop));assert(!fs.existsSync(links.start));
 record({scenario:'Deleted shortcuts are not recreated',passed:true});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
