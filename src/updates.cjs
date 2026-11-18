'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
class UpdateService {
 constructor({engine,prepare,verify,onChange=()=>{},preflight=()=>{}}){
  this.engine=engine;this.prepare=prepare;this.verify=verify;this.onChange=onChange;this.preflight=preflight;
  this.state={phase:'idle',version:'',percent:0,message:''};
  engine.autoDownload=false;engine.autoInstallOnAppQuit=false;engine.allowDowngrade=false;engine.allowPrerelease=false;
  engine.on('update-available',info=>this.set({phase:'available',version:info.version,message:'发现新版本'}));
  engine.on('update-not-available',()=>this.set({phase:'current',message:'已是最新版本'}));
  engine.on('download-progress',p=>this.set({phase:'downloading',percent:Math.floor(p.percent),message:'正在下载，可继续使用'}));
  engine.on('update-downloaded',info=>this.set({phase:'ready',version:info.version,percent:100,message:'下载完成，重启后使用新版'}));
  engine.on('error',()=>this.set({phase:'error',message:'更新失败，当前版本仍可使用。请检查网络、D 盘空间后重试。'}));
 }
 snapshot(){return {...this.state};}
 set(patch){Object.assign(this.state,patch);this.onChange();}
 async check(){if(['checking','downloading','installing','ready'].includes(this.state.phase))return;this.set({phase:'checking',message:'正在检查更新'});try{await this.engine.checkForUpdates();}catch(e){this.set({phase:'error',message:'检查失败，请检查网络后重试。当前版本不受影响。'});throw e;}}
 async download(){if(this.state.phase!=='available')throw Error('请先检查新版本');this.set({phase:'downloading',percent:0,message:'正在下载'});try{await this.preflight();await this.engine.downloadUpdate();}catch(e){this.set({phase:'error',message:'下载或校验失败，请重新检查更新。当前版本不受影响。'});throw e;}}
 async install(){if(this.state.phase!=='ready')throw Error('请先下载完整更新');this.set({phase:'installing',message:'正在备份数据与草稿'});let verified=false;try{await this.verify();verified=true;await this.prepare();this.engine.quitAndInstall(false,true);}catch(e){if(!verified){await this.engine.downloadedUpdateHelper?.clear().catch(()=>{});this.engine.downloadedUpdateHelper=null;}this.set({phase:verified?'ready':'error',message:'未安装：'+e.message});throw e;}}
}
async function verifyInstaller(engine,cacheRoot){
 const helper=engine.downloadedUpdateHelper,file=helper?.file,expected=helper?.downloadedFileInfo?.sha512;
 if(!file||!expected)throw Error('更新文件未就绪，请重新下载');
 const relative=path.relative(cacheRoot,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('更新文件不在 D 盘缓存目录');
 const hash=createHash('sha512');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 if(hash.digest('base64')!==expected)throw Error('安装包校验失败，请重新下载');
}
function diskPreflight(directory,required=1024*1024*1024){
 fs.mkdirSync(directory,{recursive:true});const stats=fs.statfsSync(directory);if(stats.bavail*stats.bsize<required)throw Error('D 盘空间不足，至少需要 1 GB 可用空间');
 const file=path.join(directory,`write-check-${process.pid}`);fs.writeFileSync(file,'',{flag:'wx'});fs.unlinkSync(file);
}
module.exports={UpdateService,verifyInstaller,diskPreflight};
