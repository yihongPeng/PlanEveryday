'use strict';
const fs=require('node:fs'),path=require('node:path');
class Startup {
 constructor({app,directory,executable=process.execPath,name='local.PlanEveryday.Desktop',supported=true}){this.app=app;this.directory=directory;this.executable=executable;this.name=name;this.supported=supported;this.file=path.join(directory,'startup-location.json');this.args=['--autostart'];}
 status(executable=this.executable){
  if(!this.supported)return {supported:false,enabled:false,note:'请在 Windows 正式桌面版中设置。'};
  try{const value=this.app.getLoginItemSettings({path:executable,args:this.args});return {supported:true,enabled:!!value.openAtLogin&&value.executableWillLaunchAtLogin!==false,registered:!!value.openAtLogin,note:value.openAtLogin&&value.executableWillLaunchAtLogin===false?'已被 Windows 禁用，可重新开启。':''};}catch{return {supported:true,enabled:false,note:'无法读取 Windows 启动设置，请稍后重试。',error:true};}
 }
 set(enabled){
  if(!this.supported)throw Error('测试或开发版本不能修改系统开机自启。');
  if(typeof enabled!=='boolean')throw Error('开机自启开关无效');
  fs.mkdirSync(this.directory,{recursive:true});
  // Store the location before registration, so a future upgrade can find the exact entry.
  fs.writeFileSync(this.file,JSON.stringify({path:this.executable}));
  this.app.setLoginItemSettings({name:this.name,path:this.executable,args:this.args,openAtLogin:enabled,enabled});
  const actual=this.status();if(actual.error||actual.enabled!==enabled||(enabled===false&&actual.registered))throw Error('Windows 未确认开机自启设置，请检查系统启动应用设置后重试。');
  return actual;
 }
 migrate(){
  if(!this.supported||!fs.existsSync(this.file))return;
  const previous=JSON.parse(fs.readFileSync(this.file,'utf8')).path;
  if(typeof previous!=='string'||previous===this.executable)return;
  const old=this.status(previous);if(old.error)throw Error('无法核对旧版开机自启设置');
  if(old.registered){this.app.setLoginItemSettings({name:this.name,path:this.executable,args:this.args,openAtLogin:true,enabled:old.enabled});}
  fs.writeFileSync(this.file,JSON.stringify({path:this.executable}));
 }
}
module.exports={Startup};
