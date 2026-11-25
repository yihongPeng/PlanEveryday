'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {normalizeStateSnapshot,stateBackup}=require('./store.cjs');
const {Media,saveBackup}=require('./media.cjs');
function sourceSnapshot(file){
 const files=new Map();
 for(const suffix of ['','-wal','-journal']){
  try{files.set(suffix,fs.readFileSync(file+suffix));}catch(error){if(suffix&&error.code==='ENOENT')files.set(suffix,null);else throw error;}
 }
 return files;
}
function sameSnapshot(a,b){return [...a].every(([key,bytes])=>bytes===null?b.get(key)===null:b.get(key)!==null&&bytes.equals(b.get(key)));}
function stableSnapshot(file){
 // Read the DB and its recovery log twice. A changing source is never treated as
 // an empty library; stop if it cannot be captured during a stable interval.
 for(let attempt=0;attempt<3;attempt++){const first=sourceSnapshot(file),second=sourceSnapshot(file);if(sameSnapshot(first,second))return second;}
 throw Error('历史数据正在变化，请正常退出旧版程序后重新迁移。');
}
function inspectSource(file,stagingDirectory){
 if(typeof stagingDirectory!=='string'||!stagingDirectory)throw Error('读取历史数据需要指定 D 盘检查目录');
 const base=path.resolve(stagingDirectory),source=path.resolve(path.dirname(file)),relative=path.relative(source,base);
 if(process.platform==='win32'&&path.parse(base).root.toLowerCase()!=='d:\\')throw Error('历史数据检查目录必须位于 D 盘');
 if(!relative||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))throw Error('历史数据检查目录不能放在原数据目录内');
 const snapshot=stableSnapshot(file);fs.mkdirSync(base,{recursive:true});const temporary=fs.mkdtempSync(path.join(base,'source-')),stagedFile=path.join(temporary,'planner.sqlite');let db;
 try{
  // SQLite is opened only on the D-drive copy. Include WAL and rollback journals;
  // do not copy SHM or use immutable mode, which can silently ignore committed WAL.
  for(const [suffix,bytes] of snapshot)if(bytes!==null)fs.writeFileSync(stagedFile+suffix,bytes,{flag:'wx'});
  db=new DatabaseSync(stagedFile);
  if(db.prepare('PRAGMA quick_check').all().some(row=>row.quick_check!=='ok'))throw Error('历史数据库校验失败，已保留原数据');
  const version=db.prepare('PRAGMA user_version').get().user_version;if(version>3)throw Error('数据来自更高版本，请使用新版程序打开');
  const row=db.prepare('SELECT data FROM planner_state WHERE id=1').get();
  return {state:row?normalizeStateSnapshot(JSON.parse(row.data),version):null,snapshot};
 }finally{
  if(db)db.close();
  // Delete only the unique inspection directory created immediately above.
  if(path.dirname(path.resolve(temporary))!==base||!path.basename(temporary).startsWith('source-'))throw Error('历史数据检查目录无效');
  fs.rmSync(temporary,{recursive:true,force:true});
 }
}
function readState(file,stagingDirectory){
 return inspectSource(file,stagingDirectory).state;
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
 const states=sources.map(dir=>path.join(dir,'planner.sqlite')).filter(file=>fs.existsSync(file)).map(file=>({file,...inspectSource(file,path.join(destination,'migration-staging'))})).filter(x=>x.state);
 const populated=states.filter(x=>x.state.tasks.length||x.state.knowledge.length||x.state.events.length||x.state.projects.length||x.state.stages.length);
 // Never guess which copy wins when multiple independent libraries exist.
 if(populated.length>1){const content=s=>JSON.stringify({tasks:s.tasks,knowledge:s.knowledge,events:s.events,projects:s.projects,stages:s.stages});if(populated.some(x=>content(x.state)!==content(populated[0].state)))throw Error('发现多份不同的历史数据，已停止自动迁移以保护内容。请保留原数据目录并联系维护者。');}
 const selected=populated[0]||states[0];if(!selected)return {migrated:false};
 // Resolve and verify every image before a destination library is created.
 for(const entry of states)entry.backup=new Media(path.dirname(entry.file),{readOnly:true}).export(stateBackup(entry.state));
 for(const entry of states)if(!sameSnapshot(entry.snapshot,sourceSnapshot(entry.file)))throw Error('历史数据正在变化，请正常退出旧版程序后重新迁移。');
 fs.mkdirSync(destination,{recursive:true});
 const backups=path.join(destination,'backups');fs.mkdirSync(backups,{recursive:true});
 const stamp=Date.now();
 // Consistent snapshots include committed WAL data; never copy a live SQLite file alone.
 states.forEach((entry,i)=>saveBackup(path.join(backups,`before-location-migration-${stamp}-${i}.json`),entry.backup));
 const temporary=target+'.migrating';
 if(fs.existsSync(temporary))throw Error('存在未完成的数据迁移，请保留该文件后联系维护者。');
 new Media(destination).restore(selected.backup,()=>{
  const db=new DatabaseSync(temporary);
  try{db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE; CREATE TABLE planner_state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');db.prepare('INSERT INTO planner_state VALUES(1,?)').run(JSON.stringify(selected.state));db.exec('PRAGMA user_version=3; COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
  fs.renameSync(temporary,target);
 });
 return {migrated:true,tasks:selected.state.tasks.length,knowledge:selected.state.knowledge?.length||0};
}
function migrationSources(home){
 const previous=path.join(home,'.planeveryday');
 // The fixed 0.2.1 database is authoritative; old redirected copies may be stale.
 return fs.existsSync(path.join(previous,'planner.sqlite'))?[previous]:legacyDirectories(home);
}
module.exports={legacyDirectories,migrationSources,migrateData,readState};
