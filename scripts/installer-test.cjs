// Real, isolated Windows installer tests. Build both QA packages first:
// node scripts/installer.cjs --qa --skip-package
// node scripts/installer.cjs --qa --qa-baseline=0.4.1 --skip-package
// Optional disk-space branch fixture:
// node scripts/installer.cjs --qa --qa-insufficient-space --skip-package
// This script never launches the production installer or touches real data.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const version=require('../package.json').version;
const qa=path.join(root,'test-results','installer-qa');
const app=path.join(qa,'app');
const data=path.join(qa,'data');
const setup=path.join(root,'release',version,'installer-qa',`PlanEveryday-Setup-${version}.exe`);
const baseline=path.join(root,'release',version,'installer-qa-baseline','PlanEveryday-Setup-0.4.1.exe');
const preflightOnly=process.argv.includes('--preflight-only');
const report=preflightOnly&&fs.existsSync(path.join(qa,'installer-test-results.json'))?JSON.parse(fs.readFileSync(path.join(qa,'installer-test-results.json'),'utf8')):[];
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const asarFile=()=>path.join(app,'resources','app.asar');
function record(scenario,extra={}){const result={scenario,passed:true,...extra};report.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(qa,'installer-test-results.json'),JSON.stringify(report,null,2));}
function run(file,args=[],env={}){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,env:{...process.env,...env},stdio:'pipe'});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const timer=setTimeout(()=>reject(Error(`Installer timed out: ${file}. Child pid ${child.pid}; inspect before stopping it.`)),90000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});});}
async function uninstall(){
 const source=path.join(app,'Uninstall PlanEveryday.exe');
 if(!fs.existsSync(source))return;
 const temp=path.join(data,'installer-temp');fs.mkdirSync(temp,{recursive:true});
 const copy=path.join(temp,'qa-uninstaller.exe');fs.copyFileSync(source,copy);
 const result=await run(copy,['/S','--delete-app-data','_?=C:\\PlanEveryday-should-not-be-created']);
 assert.equal(result.code,0);assert(!fs.existsSync(path.join(app,'PlanEveryday.exe')));
 fs.unlinkSync(copy);
}
async function checkPreflight(previous){
 const inner=fs.readFileSync(path.join(path.dirname(setup),'build','nsis-installer.exe'));
 const damaged=Buffer.from(fs.readFileSync(setup));const payloadOffset=damaged.indexOf(inner.subarray(0,4096));assert(payloadOffset>=0);
 damaged[payloadOffset+1000]^=1;const corruptBootstrap=path.join(qa,'corrupted-bootstrap.exe');fs.writeFileSync(corruptBootstrap,damaged);
 assert.equal((await run(corruptBootstrap,['/S'])).code,1);assert.equal(sha(asarFile()),previous);fs.unlinkSync(corruptBootstrap);record('Bootstrap rejects a damaged embedded NSIS payload before installer launch');
 const lowSpaceSetup=path.join(root,'release',version,'installer-qa-insufficient-space',`PlanEveryday-Setup-${version}.exe`);
 if(fs.existsSync(lowSpaceSetup)){const lowSpace=await run(lowSpaceSetup,['/S']);assert.equal(lowSpace.code,24);assert.equal(sha(asarFile()),previous);record('Insufficient-space preflight refuses replacement (QA required-space threshold)',{exitCode:24});}
}
async function main(){
 assert.equal(process.platform,'win32');assert(fs.existsSync(setup));assert(fs.existsSync(baseline));
 fs.mkdirSync(data,{recursive:true});
 if(preflightOnly){await checkPreflight(sha(asarFile()));return;}
 // Upgrade the test fixture once so its uninstaller uses current bootstrap.
 if(fs.existsSync(path.join(app,'installed-by-nsis')))assert.equal((await run(setup,['/S'])).code,0);
 fs.writeFileSync(path.join(data,'preserve-data.txt'),'QA data must survive');
 fs.mkdirSync(app,{recursive:true});fs.writeFileSync(path.join(app,'preserve-unknown.txt'),'Unknown file must survive');
 if(fs.existsSync(path.join(app,'Uninstall PlanEveryday.exe'))){
   await uninstall();assert(fs.existsSync(path.join(app,'preserve-unknown.txt')));assert(fs.existsSync(path.join(data,'preserve-data.txt')));record('Uninstall preserves unknown files and personal data, ignores redirected target');
 }
 const refused=await run(setup,['/S']);assert.equal(refused.code,25);assert(fs.existsSync(path.join(app,'preserve-unknown.txt')));record('Nonempty unknown installation directory refused',{exitCode:refused.code});
 fs.unlinkSync(path.join(app,'preserve-unknown.txt'));
 // Remove only this script's legacy sentinel, if present from an earlier run.
 const legacy=path.join(app,'preserve-program.txt');if(fs.existsSync(legacy))fs.unlinkSync(legacy);
 assert.equal((await run(baseline,['/S','/D=C:\\PlanEveryday-should-not-be-created'])).code,0);
 const asar=await import('@electron/asar');
 const installedVersion=()=>{asar.uncache(asarFile());return JSON.parse(asar.extractFile(asarFile(),'package.json').toString()).version;};
 assert.equal(installedVersion(),'0.4.1');const previous=sha(asarFile());record('Baseline 0.4.1 first installation at fixed QA path');
 await checkPreflight(previous);
 const corrupted=await run(setup,['/S'],{PLAN_INSTALLER_QA_CORRUPT_PAYLOAD:'1'});
 assert.equal(corrupted.code,27);assert.equal(sha(asarFile()),previous);record('Corrupted staged payload rejected before changing old program',{exitCode:corrupted.code});
 const failedSwap=await run(setup,['/S'],{PLAN_INSTALLER_QA_FAIL_SWAP:'1'});
 assert.equal(failedSwap.code,29);assert.equal(sha(asarFile()),previous);record('Failed new directory move restores old complete program',{exitCode:failedSwap.code});

 const lockSource=path.join(qa,'lock-program.cs');const lockExe=path.join(qa,'lock-program.exe');
 fs.writeFileSync(lockSource,'using System;using System.IO;class LockProgram{static void Main(string[] args){using(var stream=new FileStream(args[0],FileMode.Open,FileAccess.Read,FileShare.Read)){Console.WriteLine("READY");Console.Out.Flush();Console.ReadLine();}}}');
 execFileSync(path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/target:exe','/out:'+lockExe,lockSource],{windowsHide:true,env:{...process.env,TEMP:path.join(data,'installer-temp'),TMP:path.join(data,'installer-temp')}});
 const lock=spawn(lockExe,[path.join(app,'PlanEveryday.exe')],{windowsHide:true,stdio:'pipe'});
 await new Promise((resolve,reject)=>{lock.stdout.once('data',resolve);lock.once('error',reject);});
 let locked;
 try{locked=await run(setup,['/S']);}finally{lock.stdin.end('\n');}
 assert.equal(locked.code,29);assert.equal(sha(asarFile()),previous);record('Real locked program file prevents replacement and preserves old program',{exitCode:locked.code});

 const external=path.join(qa,'outside-install');fs.mkdirSync(external,{recursive:true});fs.writeFileSync(path.join(external,'keep.txt'),'outside target');
 const link=path.join(app,'unexpected-junction');fs.symlinkSync(external,link,'junction');
 const rejected=await run(setup,['/S']);assert.equal(rejected.code,1);assert.equal(sha(asarFile()),previous);assert(fs.existsSync(path.join(external,'keep.txt')));fs.unlinkSync(link);record('Nested junction rejected without touching its target',{exitCode:rejected.code});
 const cacheLink=path.join(data,'updates','unexpected-junction');fs.symlinkSync(external,cacheLink,'junction');
 assert.equal((await run(setup,['/S'])).code,1);assert(fs.existsSync(path.join(external,'keep.txt')));fs.unlinkSync(cacheLink);record('Update-cache junction rejected without touching its target');

 const upgraded=await run(setup,['/S','--updated']);assert.equal(upgraded.code,0);assert.equal(installedVersion(),version);assert.notEqual(sha(asarFile()),previous);
 const backups=fs.readdirSync(path.join(data,'updates','program-rollback')).map(name=>path.join(data,'updates','program-rollback',name,'resources','app.asar')).filter(file=>fs.existsSync(file));
 assert(backups.some(file=>sha(file)===previous));assert(fs.existsSync(path.join(data,'preserve-data.txt')));record('Actual 0.4.1 to '+version+' upgrade, complete old program backup and data preserved',{exitCode:0});
 const evidence=fs.readFileSync(path.join(data,'installer-path-evidence.txt'),'utf8');assert(!evidence.includes('C:\\'));assert(evidence.includes('PLUGINSDIR='+path.join(data,'installer-temp')));record('NSIS TEMP, plugin extraction, output and installation paths stay on D',{evidence:evidence.trim()});
 const metadata=require('js-yaml').load(fs.readFileSync(path.join(path.dirname(setup),'latest.yml'),'utf8'));
 assert.equal(metadata.files[0].size,fs.statSync(setup).size);assert.equal(metadata.files[0].sha512,crypto.createHash('sha512').update(fs.readFileSync(setup)).digest('base64'));record('Published metadata describes the actual outer setup bytes');
 console.log('QA application remains installed for updater integration testing.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
