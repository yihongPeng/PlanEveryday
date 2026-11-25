'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {normalizeStateSnapshot,stateBackup}=require('./store.cjs'),{Media,saveBackup}=require('./media.cjs');
function prepareDataUpgrade(directory,version){
 const file=path.join(directory,'planner.sqlite');if(!fs.existsSync(file))return null;
 let previous;try{previous=JSON.parse(fs.readFileSync(path.join(directory,'app-version.json'),'utf8')).version;}catch{}
 const db=new DatabaseSync(file,{readOnly:true});let state,format;
 try{format=db.prepare('PRAGMA user_version').get().user_version;if(format>3)throw Error('数据来自更高版本，请使用新版程序打开');const row=db.prepare('SELECT data FROM planner_state WHERE id=1').get();if(!row)return null;state=normalizeStateSnapshot(JSON.parse(row.data),format);}finally{db.close();}
 // The preview keeps the public app version. A format upgrade still needs a full backup.
 if(previous===version&&format===3)return null;
 const complete=new Media(directory).export(stateBackup(state));
 const target=path.join(directory,'backups',`before-upgrade-${version}-${Date.now()}.json`);
 saveBackup(target,complete);return target;
}
function markDataReady(directory,version){const file=path.join(directory,'app-version.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({version}));fs.renameSync(temp,file);}
module.exports={prepareDataUpgrade,markDataReady};
