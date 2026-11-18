const path = require('node:path');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
(async () => {
 const vendor=path.join(__dirname,'..','src','ui','vendor');fs.mkdirSync(vendor,{recursive:true});fs.copyFileSync(require.resolve('markdown-it/browser'),path.join(vendor,'markdown-it.min.js'));
 for(const [source,target] of [['highlight.min.js','highlight.min.js'],['LICENSE','highlight-LICENSE']])fs.copyFileSync(path.join(__dirname,'..','node_modules','@highlightjs','cdn-assets',source),path.join(vendor,target));
 execFileSync(process.execPath,[path.join(__dirname,'build-pet.cjs')],{stdio:'inherit',windowsHide:true});
 const { packager } = await import('@electron/packager');
 const output = await packager({ dir: path.resolve(__dirname, '..'), name: 'PlanEveryday', platform: 'win32', arch: 'x64', out: 'release/0.4.1', overwrite: true, icon: 'assets/app.ico', ignore: [/^\/(ReadHelper|release|tests|test-results|docs|scripts|native|\.git)(\/|$)/], asar: true, appCopyright: 'PlanEveryday', win32metadata: { ProductName: '芽芽计划', FileDescription: '芽芽计划 · 个人计划助手', CompanyName: 'PlanEveryday' } });
 for(const folder of output){const dest=path.join(folder,'resources','native');fs.mkdirSync(dest,{recursive:true});fs.copyFileSync(path.join(__dirname,'..','native','bin','PlanEveryday.Pet.exe'),path.join(dest,'PlanEveryday.Pet.exe'));}
 console.log(output.join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1;});
