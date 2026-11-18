const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const projectMetadata = require('../package.json');
const qa = process.argv.includes('--qa');
const launchProbe = process.argv.includes('--qa-launch-probe');
if(launchProbe&&!qa)throw new Error('The launch probe requires --qa.');
const insufficientSpace = process.argv.includes('--qa-insufficient-space');
if(insufficientSpace&&!qa)throw new Error('Insufficient-space simulation requires --qa.');
const baseline = process.argv.find(argument=>argument.startsWith('--qa-baseline='))?.slice('--qa-baseline='.length);
if(baseline&&(!qa||!/^\d+\.\d+\.\d+$/.test(baseline)))throw new Error('A QA baseline requires --qa and a numeric version.');
const metadata = baseline ? {...projectMetadata,version:baseline} : projectMetadata;
const skipPackage = process.argv.includes('--skip-package');
if (process.platform !== 'win32') throw new Error('The Windows installer must be built on Windows.');
const qaFolder = launchProbe ? 'installer-launch-qa' : 'installer-qa';
const dataDir = qa ? path.join(root, 'test-results', qaFolder, 'data') : path.resolve('D:/PlanEverydayData');
const installDir = qa ? path.join(root, 'test-results', qaFolder, 'app') : path.resolve('D:/Programs/PlanEveryday');
const tempDir = path.join(dataDir, 'installer-temp');
const outputDir = path.join(root, 'release', projectMetadata.version, qa ? (launchProbe?'installer-qa-launch-probe':baseline?'installer-qa-baseline':insufficientSpace?'installer-qa-insufficient-space':'installer-qa') : 'installer');
const generated = path.join(outputDir, 'build');
const packaged = launchProbe ? path.join(generated,'launch-probe-app') : baseline ? path.join(generated,'baseline-app') : path.join(root, 'release', metadata.version, 'PlanEveryday-win32-x64');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
for (const directory of [generated, tempDir, 'D:/PlanEverydayData/build-temp']) fs.mkdirSync(directory, {recursive:true});
process.env.TEMP = process.env.TMP = 'D:/PlanEverydayData/build-temp';
process.env.ELECTRON_BUILDER_CACHE = 'D:/PlanEverydayData/build-cache/electron-builder';
process.env.ELECTRON_CACHE = 'D:/PlanEverydayData/build-cache/electron';
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const nsisPath = value => value.replaceAll('/', '\\');
const nsisQuote = value => nsisPath(value).replaceAll('$', '$$').replaceAll('"', '$\\"');

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Pinned NSIS template changed: ${label}`);
  return source.replace(before, after);
}
function filesIn(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the payload: ${relative}`);
    return entry.isDirectory() ? filesIn(path.join(directory, entry.name), relative) : [relative];
  }).sort();
}
function wrapExecutable(payload, output, isUninstaller) {
  const info = path.join(generated, isUninstaller ? 'uninstaller-info.cs' : 'installer-info.cs');
  const source = `[assembly:System.Reflection.AssemblyTitle("芽芽计划")]
[assembly:System.Reflection.AssemblyProduct("芽芽计划")]
[assembly:System.Reflection.AssemblyVersion("${metadata.version}.0")]
internal static class BuildInfo {
 public const string TempRoot = @"${tempDir.replaceAll('"', '""')}";
 public const string InstallRoot = @"${installDir.replaceAll('"', '""')}";
 public const string UpdateRoot = @"${path.join(dataDir,'updates').replaceAll('"', '""')}";
 public const string PayloadSha256 = "${digest(payload)}";
 public static readonly bool IsUninstaller = ${isUninstaller};
}`;
  fs.writeFileSync(info, source);
  execFileSync(compiler, ['/nologo','/optimize+','/platform:x64','/target:winexe','/codepage:65001', '/reference:System.Windows.Forms.dll', `/win32icon:${path.join(root,'assets','app.ico')}`, `/out:${output}`, `/resource:${payload},nsis.payload`, path.join(root,'build','installer-bootstrap.cs'), info], {stdio:'inherit', windowsHide:true});
}

async function main() {
  if (require('electron-builder/package.json').version !== '26.18.1') throw new Error('Review the NSIS adaptation before upgrading electron-builder.');
  if(launchProbe){
    fs.mkdirSync(path.join(packaged,'resources'),{recursive:true});
    const probeSource=path.join(generated,'launch-probe.cs');
    const launchLog=path.join(dataDir,'launches.tsv').replaceAll('"','""');
    fs.writeFileSync(probeSource,`using System;using System.IO;using System.Reflection;class LaunchProbe{static void Main(string[] args){File.AppendAllText(@"${launchLog}",Assembly.GetExecutingAssembly().Location+"\\t"+String.Join(" ",args)+"\\t"+Environment.CurrentDirectory+"\\r\\n");}}`);
    execFileSync(compiler,['/nologo','/target:winexe','/platform:x64',`/out:${path.join(packaged,'PlanEveryday.exe')}`,probeSource],{stdio:'inherit',windowsHide:true});
  }
  else if(baseline)fs.cpSync(path.join(root,'release',baseline,'PlanEveryday-win32-x64'),packaged,{recursive:true});
  else if (!skipPackage) execFileSync(process.execPath, [path.join(__dirname,'package.cjs')], {stdio:'inherit', windowsHide:true});
  if (!fs.existsSync(path.join(packaged,'PlanEveryday.exe'))) throw new Error('Run npm run package first.');
  // Prepackaged builds need this file explicitly, and its hash belongs in the
  // verified payload. Updater cache base is supplied by the app on D.
  fs.writeFileSync(path.join(packaged,'resources','app-update.yml'), 'provider: github\nowner: yihongPeng\nrepo: PlanEveryday\nupdaterCacheDirName: planeveryday-updater\n');
  const files = filesIn(packaged);
  const total = files.reduce((sum, file) => sum + fs.statSync(path.join(packaged,file)).size, 0);
  const required = insufficientSpace ? Number.MAX_SAFE_INTEGER : total * 4 + 256 * 1024 * 1024;
  const manifest = path.join(generated, 'payload.nsh');
  fs.writeFileSync(manifest, '!macro planValidatePayload\n' + files.map(file => ` !insertmacro planValidateFile "${nsisQuote(file)}" "${digest(path.join(packaged,file)).toUpperCase()}"`).join('\n') + '\n!macroend\n');
  const directories = [...new Set(files.flatMap(file => {const list=[];for(let parent=path.dirname(file);parent!=='.';parent=path.dirname(parent))list.push(parent);return list;}))].sort((a,b)=>b.length-a.length);
  fs.appendFileSync(manifest, '!macro planRemovePayload\n' + files.map(file=>` Delete "$INSTDIR\\${nsisQuote(file)}"`).join('\n')+'\n'+directories.map(directory=>` RMDir "$INSTDIR\\${nsisQuote(directory)}"`).join('\n')+'\n!macroend\n');
  const uninstallerManifest = path.join(generated,'uninstaller-hash.nsh');
  fs.writeFileSync(uninstallerManifest, '!macro planValidateUninstaller\n!macroend\n');
  const hooks = path.join(generated, 'installer-hooks.nsh');
  fs.writeFileSync(hooks, `${qa?'!define PLAN_QA\n':''}!define PLAN_INSTALL_DIR "${nsisQuote(installDir)}"\n!define PLAN_DATA_DIR "${nsisQuote(dataDir)}"\n!define PLAN_TEMP_DIR "${nsisQuote(tempDir)}"\n!define PLAN_REQUIRED_BYTES ${required}\n!define PLAN_REQUIRED_MB ${Math.ceil(required/1024/1024)}\n!include "${nsisQuote(manifest)}"\n!include "${nsisQuote(uninstallerManifest)}"\n!include "${nsisQuote(path.join(root,'build','installer-hooks.nsh'))}"\n`);

  // Work on a staging copy of the exactly pinned upstream templates, leaving
  // node_modules unchanged. These small, asserted substitutions keep builder's
  // standard uninstaller generation, metadata, registry and shortcut behavior.
  const {build,Platform,Arch}=require('electron-builder');
  const nsisUtil = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const templates = path.join(generated, 'nsis-templates');
  fs.cpSync(nsisUtil.nsisTemplatesDir, templates, {recursive:true});
  nsisUtil.nsisTemplatesDir = templates;
  const edit = (file, transform) => {const name=path.join(templates,file);fs.writeFileSync(name,transform(fs.readFileSync(name,'utf8').replaceAll('\r\n','\n')));};
  // Probe links live on D as well; the real Desktop and Start menu are untouched.
  if(launchProbe)edit('common.nsh',source=>source.replaceAll('$DESKTOP','${PLAN_DATA_DIR}\\shortcut-test\\desktop').replaceAll('$SMPROGRAMS','${PLAN_DATA_DIR}\\shortcut-test\\start-menu'));
  // A persisted .lnk may point to a portable or rollback copy. The freshly
  // installed executable is the only valid post-install launch target.
  edit('common.nsh',source=>replaceOnce(source,'${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$startAppArgs"','${StdUtils.ExecShellAsUser} $0 "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "open" "$startAppArgs"','direct installed executable launch'));
  edit('installer.nsi', source => {
    source = replaceOnce(source, '  !ifmacrodef preInit\n    !insertmacro preInit\n  !endif', '', 'remove late preInit');
    return replaceOnce(source, 'Function .onInit\n', 'Function .onInit\n  !ifndef BUILD_UNINSTALLER\n    !insertmacro preInit\n  !endif\n', 'early preInit');
  });
  edit('uninstaller.nsh', source => {
    source = replaceOnce(source,'Function un.onInit\n','Function un.onInit\n  !insertmacro preInit\n','uninstaller temp');
    const start = source.indexOf('  Var /GLOBAL isDeleteAppData\n');
    const end = source.indexOf('  DeleteRegKey SHELL_CONTEXT', start);
    if(start<0||end<0)throw new Error('Pinned NSIS app-data deletion block changed.');
    return source.slice(0,start) + '  ; Personal app data is never removed, including --delete-app-data.\n' + source.slice(end);
  });
  edit('installSection.nsh', source => {
    source = replaceOnce(source,'Var /GLOBAL keepShortcuts','!insertmacro planPreparePayload\n\nVar /GLOBAL keepShortcuts','preflight');
    source = replaceOnce(source,'!insertmacro uninstallOldVersion SHELL_CONTEXT\n!insertmacro handleUninstallResult SHELL_CONTEXT\n\n${if} $installMode == "all"\n  !insertmacro uninstallOldVersion HKEY_CURRENT_USER\n  !insertmacro handleUninstallResult HKEY_CURRENT_USER\n${endIf}','!insertmacro planSwapApplication','atomic swap');
    return replaceOnce(source,'!insertmacro installApplicationFiles','; Payload, uninstaller and marker were verified before the atomic swap.\nReadEnvStr $0 "PLAN_INSTALLER_SOURCE"\n!insertmacro copyFile "$0" "${PLAN_DATA_DIR}\\updates\\${APP_INSTALLER_STORE_FILE}"','D installer cache');
  });
  const {NsisTarget} = require('app-builder-lib/out/targets/nsis/NsisTarget');
  const original = NsisTarget.prototype.computeScriptAndSignUninstaller;
  let uninstallerSha256;
  NsisTarget.prototype.computeScriptAndSignUninstaller = async function(defines,commands,installerPath,sharedHeader,archs) {
    const result = await original.call(this,defines,commands,installerPath,sharedHeader,archs);
    const uninstaller = path.join(outputDir, `${path.basename(installerPath,'exe')}__uninstaller.exe`);
    const payload = path.join(generated,'nsis-uninstaller.exe');
    fs.copyFileSync(uninstaller,payload);
    wrapExecutable(payload,uninstaller,true);
    uninstallerSha256=digest(uninstaller);
    const markerHash=crypto.createHash('sha256').update(`PlanEveryday NSIS ${metadata.version}\r\n`).digest('hex').toUpperCase();
    fs.writeFileSync(uninstallerManifest, `!macro planValidateUninstaller\n !insertmacro planValidateFile "Uninstall PlanEveryday.exe" "${digest(uninstaller).toUpperCase()}"\n !insertmacro planValidateFile "installed-by-nsis" "${markerHash}"\n!macroend\n`);
    return result;
  };
  const config = {...require('../build/electron-builder.cjs'), directories:{buildResources:'build', output:outputDir}};
  if(baseline)config.extraMetadata={version:baseline};
  config.nsis={...config.nsis,include:hooks};
  if(qa){config.appId='local.PlanEveryday.InstallerQA';config.nsis={...config.nsis,createDesktopShortcut:false,createStartMenuShortcut:false,runAfterFinish:false};}
  if(launchProbe){config.appId='local.PlanEveryday.InstallerLaunchQA';config.nsis={...config.nsis,createDesktopShortcut:true,createStartMenuShortcut:true,runAfterFinish:true,shortcutName:'PlanEveryday launch QA',uninstallDisplayName:'PlanEveryday launch QA'};}
  await build({projectDir:root,prepackaged:packaged,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config,publish:'never'});
  const setup = path.join(outputDir,`PlanEveryday-Setup-${metadata.version}.exe`);
  const inner = path.join(generated,'nsis-installer.exe');
  fs.copyFileSync(setup,inner);
  wrapExecutable(inner,setup,false);
  // Clients download the bootstrap, so all update metadata describes its bytes.
  const {buildBlockMap}=require('app-builder-lib/out/targets/blockmap/blockmap');
  const info=await buildBlockMap(setup,'gzip',setup+'.blockmap');
  const sha512=crypto.createHash('sha512').update(fs.readFileSync(setup)).digest('base64');
  const size=fs.statSync(setup).size;
  fs.writeFileSync(path.join(outputDir,'latest.yml'),`version: ${metadata.version}\nfiles:\n  - url: ${path.basename(setup)}\n    sha512: ${sha512}\n    size: ${size}\npath: ${path.basename(setup)}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
  if(info.sha512!==sha512||info.size!==size)throw new Error('Bootstrap update metadata mismatch.');
  fs.writeFileSync(path.join(outputDir,'build-proof.json'),JSON.stringify({version:metadata.version,qa,installDir,dataDir,tempDir,payloadFiles:files.length,payloadBytes:total,requiredFreeBytes:required,setup,sha512,size,uninstallerSha256},null,2));
  console.log(`Installer ready: ${setup}`);
}
main().catch(error=>{console.error(error);process.exit(1);});
