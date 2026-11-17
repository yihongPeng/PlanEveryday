const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs');
const {migrateData,readState}=require('../src/data-location.cjs');
test('D drive migration prefers latest fixed database over stale redirected copies',()=>{
 const {migrationSources}=require('../src/data-location.cjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'planner-home-'));
 try{const dir=path.join(root,'.planeveryday');const s=new Store(path.join(dir,'planner.sqlite'));s.addKnowledge({title:'最新'});s.close();assert.deepEqual(migrationSources(root),[dir]);const target=path.join(root,'D-data');assert.equal(migrateData(target,migrationSources(root)).knowledge,1);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('subsequent startups retain new content and never reimport stale legacy data',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planner-location-'));const old=path.join(root,'old'),target=path.join(root,'stable');
 try{
  const previous=new Store(path.join(old,'planner.sqlite'));previous.addKnowledge({title:'旧内容',content:'迁移前'});previous.close();
  migrateData(target,[old]);
  const current=new Store(path.join(target,'planner.sqlite'));const item=current.snapshot().knowledge[0];current.updateKnowledge(item.id,{content:'迁移后编辑，重启必须保留'});current.addKnowledge({title:'新保存内容'});const expected=current.snapshot();current.close();
  for(let i=0;i<3;i++){assert.equal(migrateData(target,[old]).migrated,false);const reopened=new Store(path.join(target,'planner.sqlite'));assert.deepEqual(reopened.snapshot(),expected);reopened.close();}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('migration chooses populated redirected library, includes WAL and preserves sources',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planner-location-'));const normal=path.join(root,'normal'),redirected=path.join(root,'redirected'),target=path.join(root,'stable');
 const a=new Store(path.join(normal,'planner.sqlite')),b=new Store(path.join(redirected,'planner.sqlite'));
 try{a.mutate(()=>{});b.addKnowledge({title:'知识',content:'持久内容'});const original=b.snapshot();assert.equal(migrateData(target,[normal,redirected]).knowledge,1);assert.deepEqual(readState(path.join(target,'planner.sqlite')),original);assert.deepEqual(b.snapshot(),original);assert.equal(fs.readdirSync(path.join(target,'backups')).length,2);assert.equal(migrateData(target,[normal]).migrated,false);}finally{a.close();b.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('different populated libraries stop migration without overwriting either',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planner-location-'));const dirs=['a','b'].map(n=>path.join(root,n));
 for(const dir of dirs){const s=new Store(path.join(dir,'planner.sqlite'));s.addKnowledge({title:path.basename(dir)});s.close();}
 try{assert.throws(()=>migrateData(path.join(root,'target'),dirs),/多份/);assert.equal(fs.existsSync(path.join(root,'target','planner.sqlite')),false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
