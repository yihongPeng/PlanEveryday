const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {Media,saveBackup}=require('../src/media.cjs');
const directory=process.argv[2]||'D:/PlanEverydayData';
const file=path.join(directory,'planner.sqlite');
if(fs.existsSync(file)){
 const db=new DatabaseSync(file,{readOnly:true});
 const row=db.prepare('SELECT data FROM planner_state WHERE id=1').get();db.close();
 if(row){const state=JSON.parse(row.data);const settings={};for(const key of ['petVisible','petAlwaysOnTop','doNotDisturb'])settings[key]=state.settings[key];const data={schemaVersion:3,exportedAt:new Date().toISOString(),tasks:state.tasks,events:state.events,settings,knowledge:(state.knowledge||[]).map(k=>({...k,tags:k.tags||[]}))};const dest=path.join(directory,'backups',`before-update-${Date.now()}.json`);saveBackup(dest,new Media(directory).export(data));console.log(JSON.stringify({backup:dest,tasks:data.tasks.length,knowledge:data.knowledge.length}));}
}
