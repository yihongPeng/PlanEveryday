'use strict';
const fs=require('node:fs'),path=require('node:path');
const INSTALL_DIRECTORY=path.resolve('D:/Programs/PlanEveryday');
function installedExecutable(directory=INSTALL_DIRECTORY){
 const executable=path.join(directory,'PlanEveryday.exe');
 try{
  const marker=fs.readFileSync(path.join(directory,'installed-by-nsis'),'utf8');
  if(/^PlanEveryday NSIS \d+\.\d+\.\d+\r?\n?$/.test(marker)&&fs.statSync(executable).isFile())return executable;
 }catch{}
 return null;
}
function desktopExecutable(executable=process.execPath,directory=INSTALL_DIRECTORY){
 // A portable copy must never redirect the user's installed shortcuts/startup.
 return installedExecutable(directory)||executable;
}
function isInstalledExecutable(executable=process.execPath,directory=INSTALL_DIRECTORY){
 const installed=installedExecutable(directory);
 return !!installed&&path.resolve(executable).toLowerCase()===path.resolve(installed).toLowerCase();
}
module.exports={desktopExecutable,isInstalledExecutable};
