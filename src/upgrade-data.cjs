'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {validateBackup}=require('./store.cjs'),{Media,saveBackup}=require('./media.cjs');
function prepareDataUpgrade(directory,version){
 const file=path.join(directory,'planner.sqlite');if(!fs.existsSync(file))return null;
 let previous;try{previous=JSON.parse(fs.readFileSync(path.join(directory,'app-version.json'),'utf8')).version;}catch{}
 // Even same-version starts validate the state in Store. Back up once per app upgrade.
 if(previous===version)return null;
 const db=new DatabaseSync(file,{readOnly:true});let state;
 try{if(db.prepare('PRAGMA user_version').get().user_version>1)throw Error('数据来自更高版本，请使用新版程序打开');const row=db.prepare('SELECT data FROM planner_state WHERE id=1').get();if(!row)return null;state=JSON.parse(row.data);}finally{db.close();}
 const schemaVersion=!Object.hasOwn(state,'knowledge')?1:state.knowledge.some(k=>!Object.hasOwn(k,'tags'))?2:3;
 const backup=validateBackup({...state,schemaVersion,exportedAt:new Date().toISOString()});
 const complete=new Media(directory).export(backup);
 const target=path.join(directory,'backups',`before-upgrade-${version}-${Date.now()}.json`);
 saveBackup(target,complete);return target;
}
function markDataReady(directory,version){const file=path.join(directory,'app-version.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({version}));fs.renameSync(temp,file);}
module.exports={prepareDataUpgrade,markDataReady};
