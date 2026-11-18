const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {desktopExecutable,isInstalledExecutable}=require('../src/desktop-location.cjs');
function fixture(){const root=fs.mkdtempSync(path.resolve('test-results/desktop-location-'));const installed=path.join(root,'installed'),portable=path.join(root,'portable','PlanEveryday.exe');fs.mkdirSync(installed);return {installed,portable,target:path.join(installed,'PlanEveryday.exe')};}
test('desktop and startup integrations keep the installed executable when a portable copy starts',()=>{
 const x=fixture();fs.writeFileSync(x.target,'test executable');fs.writeFileSync(path.join(x.installed,'installed-by-nsis'),'PlanEveryday NSIS 0.5.1\r\n');
 assert.equal(desktopExecutable(x.portable,x.installed),x.target);
 assert.equal(isInstalledExecutable(x.target,x.installed),true);
 assert.equal(isInstalledExecutable(x.portable,x.installed),false,'portable copies must not enable an updater that would replace another path');
});
test('missing or unrecognized installations cannot take over desktop entries',()=>{
 const x=fixture();assert.equal(desktopExecutable(x.portable,x.installed),x.portable);
 fs.writeFileSync(x.target,'test executable');assert.equal(desktopExecutable(x.portable,x.installed),x.portable);
 fs.writeFileSync(path.join(x.installed,'installed-by-nsis'),'not our installation');assert.equal(desktopExecutable(x.portable,x.installed),x.portable);
 assert.equal(isInstalledExecutable(x.target,x.installed),false);
});
