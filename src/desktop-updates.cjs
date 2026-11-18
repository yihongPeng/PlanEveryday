'use strict';
const path=require('node:path');
const {UpdateService,verifyInstaller,diskPreflight}=require('./updates.cjs');
function createDesktopUpdates({app,prepare,onChange}){
 const installed=app.isPackaged&&require('./desktop-location.cjs').isInstalledExecutable();
 if(!installed||process.env.PLANEVERYDAY_DATA_DIR)return {snapshot:()=>({supported:false,phase:'unavailable',message:'请安装安装版以启用一键更新；现有 D 盘数据会自动保留。'}),check:()=>{throw Error('请先使用安装版');},download:()=>{},install:()=>{}};
 const cache=path.join(app.getPath('userData'),'updates');
 const {NsisUpdater}=require('electron-updater');const engine=new NsisUpdater();
 Object.defineProperty(engine.app,'baseCachePath',{get:()=>cache});
 engine.logger=null;engine.disableWebInstaller=true;engine.disableDifferentialDownload=true;
 const service=new UpdateService({engine,prepare,verify:()=>verifyInstaller(engine,cache),preflight:()=>diskPreflight(cache),onChange});
 const snapshot=service.snapshot.bind(service);service.snapshot=()=>({supported:true,...snapshot()});
 // Quiet check once per launch, never download or restart without a click.
 const timer=setTimeout(()=>service.check().catch(()=>{}),15000);timer.unref();
 return service;
}
module.exports={createDesktopUpdates};


