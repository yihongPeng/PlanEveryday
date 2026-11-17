const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const directory=process.argv[2]||'D:/PlanEverydayData';
const file=path.join(directory,'planner.sqlite');
if(fs.existsSync(file)){
 const db=new DatabaseSync(file,{readOnly:true});
 const row=db.prepare('SELECT data FROM planner_state WHERE id=1').get();db.close();
 if(row){const state=JSON.parse(row.data);const settings={};for(const key of ['petVisible','petAlwaysOnTop','doNotDisturb'])settings[key]=state.settings[key];const data={schemaVersion:Array.isArray(state.knowledge)?(state.knowledge.every(k=>Array.isArray(k.tags))?3:2):1,exportedAt:new Date().toISOString(),tasks:state.tasks,events:state.events,settings};if(data.schemaVersion>=2)data.knowledge=state.knowledge;const folder=path.join(directory,'backups');fs.mkdirSync(folder,{recursive:true});const dest=path.join(folder,`before-v0.2-${Date.now()}.json`);fs.writeFileSync(dest,JSON.stringify(data,null,2));console.log(JSON.stringify({backup:dest,tasks:data.tasks.length,knowledge:data.knowledge?.length||0}));}
}
