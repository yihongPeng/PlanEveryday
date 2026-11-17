'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {validateBackup}=require('./store.cjs');
function readState(file){
 const db=new DatabaseSync(file,{readOnly:true});
 try { const row=db.prepare('SELECT data FROM planner_state WHERE id=1').get();if(!row)return null;const state=JSON.parse(row.data);validateBackup({...state,schemaVersion:Array.isArray(state.knowledge)?2:1});return state; } finally {db.close();}
}
function legacyDirectories(home){
 const result=[path.join(home,'AppData','Roaming','芽芽计划')];
 const packages=path.join(home,'AppData','Local','Packages');
 if(fs.existsSync(packages))for(const entry of fs.readdirSync(packages,{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith('OpenAI.Codex_'))result.push(path.join(packages,entry.name,'LocalCache','Roaming','芽芽计划'));
 return result;
}
function migrateData(destination,sources){
 const target=path.join(destination,'planner.sqlite');
 if(fs.existsSync(target))return {migrated:false};
 const states=sources.map(dir=>path.join(dir,'planner.sqlite')).filter(file=>fs.existsSync(file)).map(file=>({file,state:readState(file)})).filter(x=>x.state);
 const populated=states.filter(x=>x.state.tasks.length||(x.state.knowledge||[]).length||x.state.events.length);
 // Never guess which copy wins when multiple independent libraries exist.
 if(populated.length>1){const content=s=>JSON.stringify({tasks:s.tasks,knowledge:s.knowledge||[],events:s.events});if(populated.some(x=>content(x.state)!==content(populated[0].state)))throw Error('发现多份不同的历史数据，已停止自动迁移以保护内容。请保留原数据目录并联系维护者。');}
 const selected=populated[0]||states[0];if(!selected)return {migrated:false};
 fs.mkdirSync(destination,{recursive:true});
 const backups=path.join(destination,'backups');fs.mkdirSync(backups,{recursive:true});
 const stamp=Date.now();
 // Consistent snapshots include committed WAL data; never copy a live SQLite file alone.
 states.forEach((entry,i)=>fs.writeFileSync(path.join(backups,`before-location-migration-${stamp}-${i}.json`),JSON.stringify({...entry.state,schemaVersion:entry.state.knowledge?2:1,exportedAt:new Date().toISOString()}),{flag:'wx'}));
 const temporary=target+'.migrating';
 if(fs.existsSync(temporary))throw Error('存在未完成的数据迁移，请保留该文件后联系维护者。');
 const db=new DatabaseSync(temporary);
 try{db.exec('PRAGMA synchronous=FULL; CREATE TABLE planner_state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');db.prepare('INSERT INTO planner_state VALUES(1,?)').run(JSON.stringify(selected.state));}finally{db.close();}
 fs.renameSync(temporary,target);
 return {migrated:true,tasks:selected.state.tasks.length,knowledge:selected.state.knowledge?.length||0};
}
function migrationSources(home){
 const previous=path.join(home,'.planeveryday');
 // The fixed 0.2.1 database is authoritative; old redirected copies may be stale.
 return fs.existsSync(path.join(previous,'planner.sqlite'))?[previous]:legacyDirectories(home);
}
module.exports={legacyDirectories,migrationSources,migrateData,readState};
