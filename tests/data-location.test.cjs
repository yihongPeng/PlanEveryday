const {testDirectory}=require('./test-paths.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../src/store.cjs');
const {migrateData,readState}=require('../src/data-location.cjs');
test('D drive migration prefers latest fixed database over stale redirected copies',()=>{
 const {migrationSources}=require('../src/data-location.cjs');const root=testDirectory('planner-home-');
 try{const dir=path.join(root,'.planeveryday');const s=new Store(path.join(dir,'planner.sqlite'));s.addKnowledge({title:'最新'});s.close();assert.deepEqual(migrationSources(root),[dir]);const target=path.join(root,'D-data');assert.equal(migrateData(target,migrationSources(root)).knowledge,1);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('subsequent startups retain new content and never reimport stale legacy data',()=>{
 const root=testDirectory('planner-location-');const old=path.join(root,'old'),target=path.join(root,'stable');
 try{
  const previous=new Store(path.join(old,'planner.sqlite'));previous.addKnowledge({title:'旧内容',content:'迁移前'});previous.close();
  migrateData(target,[old]);
  const current=new Store(path.join(target,'planner.sqlite'));const item=current.snapshot().knowledge[0];current.updateKnowledge(item.id,{content:'迁移后编辑，重启必须保留'});current.addKnowledge({title:'新保存内容'});const expected=current.snapshot();current.close();
  for(let i=0;i<3;i++){assert.equal(migrateData(target,[old]).migrated,false);const reopened=new Store(path.join(target,'planner.sqlite'));assert.deepEqual(reopened.snapshot(),expected);reopened.close();}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('migration chooses populated redirected library, includes WAL and preserves sources',()=>{
 const root=testDirectory('planner-location-');const normal=path.join(root,'normal'),redirected=path.join(root,'redirected'),target=path.join(root,'stable');
 const a=new Store(path.join(normal,'planner.sqlite')),b=new Store(path.join(redirected,'planner.sqlite'));
 try{a.mutate(()=>{});b.addKnowledge({title:'知识',content:'持久内容'});const original=b.snapshot();assert.equal(migrateData(target,[normal,redirected]).knowledge,1);assert.deepEqual(readState(path.join(target,'planner.sqlite'),path.join(root,'inspection')),original);assert.deepEqual(b.snapshot(),original);assert.equal(fs.readdirSync(path.join(target,'backups')).length,2);assert.equal(migrateData(target,[normal]).migrated,false);}finally{a.close();b.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('different populated libraries stop migration without overwriting either',()=>{
 const root=testDirectory('planner-location-');const dirs=['a','b'].map(n=>path.join(root,n));
 for(const dir of dirs){const s=new Store(path.join(dir,'planner.sqlite'));s.addKnowledge({title:path.basename(dir)});s.close();}
 try{assert.throws(()=>migrateData(path.join(root,'target'),dirs),/多份/);assert.equal(fs.existsSync(path.join(root,'target','planner.sqlite')),false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('location migration preserves v2 organization, full image backups and the new format marker',()=>{
 const root=fs.mkdtempSync(path.resolve('test-results/project-location-')),old=path.join(root,'old'),target=path.join(root,'target'),{Media}=require('../src/media.cjs'),{DatabaseSync}=require('node:sqlite');
 const store=new Store(path.join(old,'planner.sqlite')),project=store.addProject({title:'只有阶段的项目'}),stage=store.addStage({title:'阶段',projectId:project.id}),media=new Media(old),uri=media.add(fs.readFileSync(path.resolve('assets/app.png')));store.addKnowledge({title:'图文',content:`![](${uri})`});const before=store.snapshot();store.close();
 migrateData(target,[old]);assert.deepEqual(readState(path.join(target,'planner.sqlite'),path.join(root,'inspection')),before);const db=new DatabaseSync(path.join(target,'planner.sqlite'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);db.close();assert.deepEqual(new Media(target).read(uri),media.read(uri));const backup=JSON.parse(fs.readFileSync(path.join(target,'backups',fs.readdirSync(path.join(target,'backups'))[0])));assert.equal(backup.schemaVersion,6);assert.equal(backup.stages[0].id,stage.id);assert.equal(backup.attachments.length,1);
});

test('different project-only libraries are not mistaken for empty libraries',()=>{
 const root=fs.mkdtempSync(path.resolve('test-results/project-conflict-')),sources=['a','b'].map(name=>path.join(root,name));for(const dir of sources){const store=new Store(path.join(dir,'planner.sqlite'));store.addProject({title:path.basename(dir)});store.close();}assert.throws(()=>migrateData(path.join(root,'target'),sources),/多份/);
});

function sourceFiles(directory){return Object.fromEntries(fs.readdirSync(directory).sort().map(name=>{const file=path.join(directory,name),stat=fs.statSync(file);return [name,stat.isDirectory()?sourceFiles(file):{hash:require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),mtime:stat.mtimeMs}];}));}
test('source inspection reads committed WAL without creating source sidecars',()=>{
 const root=testDirectory('location-readonly-'),live=path.join(root,'live'),source=path.join(root,'source'),staging=path.join(root,'inspection'),file=path.join(source,'planner.sqlite'),writer=new Store(path.join(live,'planner.sqlite'));
 try{writer.addTask({title:'仅在 WAL 中的新任务',plannedDate:'2026-11-25',plannedEndDate:'2026-11-28'});const expected=writer.snapshot();fs.mkdirSync(source);fs.copyFileSync(path.join(live,'planner.sqlite'),file);fs.copyFileSync(path.join(live,'planner.sqlite-wal'),file+'-wal');const before=sourceFiles(source);assert.deepEqual(readState(file,staging),expected);assert.deepEqual(sourceFiles(source),before);assert.equal(fs.existsSync(file+'-shm'),false);}finally{writer.close();}
});
test('migration never creates an images directory or alters files in a legacy source',()=>{
 const root=testDirectory('location-source-'),source=path.join(root,'source'),target=path.join(root,'target'),store=new Store(path.join(source,'planner.sqlite'));store.addTask({title:'无图片的旧任务'});const expected=store.snapshot();store.close();const before=sourceFiles(source);assert.equal(fs.existsSync(path.join(source,'images')),false);migrateData(target,[source]);assert.deepEqual(sourceFiles(source),before);assert.deepEqual(readState(path.join(target,'planner.sqlite'),path.join(root,'inspection')),expected);
});
test('source changing throughout inspection is rejected without creating a destination library',()=>{
 const root=testDirectory('location-changing-'),source=path.join(root,'source'),target=path.join(root,'target'),file=path.join(source,'planner.sqlite'),store=new Store(file),task=store.addTask({title:'不断写入'}),originalRead=fs.readFileSync;let edits=0;
 try{fs.readFileSync=function(input,...rest){if(path.resolve(String(input))===file)store.updateTask(task.id,{title:'变化'+(++edits)});return originalRead.call(this,input,...rest);};assert.throws(()=>migrateData(target,[source]),/变化|正在使用/);assert.equal(fs.existsSync(path.join(target,'planner.sqlite')),false);}finally{fs.readFileSync=originalRead;store.close();}
});
