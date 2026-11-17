const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../src/store.cjs');
test('tags normalize, persist, export and reject invalid input without changing data',()=>{
 const dir=fs.mkdtempSync(path.resolve('test-results/tags-'));const file=path.join(dir,'planner.sqlite');let s=new Store(file);
 try{const k=s.addKnowledge({title:'标签测试',tags:[' C++ ','c++','网络']});assert.deepEqual(k.tags,['C++','网络']);s.close();s=new Store(file);assert.deepEqual(s.snapshot().knowledge[0].tags,k.tags);const before=s.snapshot();for(const tags of [null,'C++',[1],['x'.repeat(25)],Array.from({length:13},(_,i)=>''+i)])assert.throws(()=>s.updateKnowledge(k.id,{tags}));assert.deepEqual(s.snapshot(),before);s.db.exec('PRAGMA query_only=ON');assert.throws(()=>s.updateKnowledge(k.id,{tags:['失败']}));assert.deepEqual(s.snapshot(),before);s.db.exec('PRAGMA query_only=OFF');const backup=s.exportBackup();assert.equal(backup.schemaVersion,3);s.updateKnowledge(k.id,{tags:[]});s.restoreBackup(backup);assert.deepEqual(s.snapshot().knowledge[0].tags,k.tags);}finally{s.close();}
});
test('old notes and v2 backups receive empty tags without changing text or timestamps',()=>{
 const s=new Store(':memory:');try{const k=s.addKnowledge({title:'旧内容',content:'正文'});const backup=s.exportBackup();backup.schemaVersion=2;delete backup.knowledge[0].tags;s.restoreBackup(backup);assert.deepEqual(s.snapshot().knowledge[0],{...k,tags:[]});const bad=s.exportBackup();bad.knowledge[0].tags=['重复','重复'];assert.throws(()=>s.restoreBackup(bad));}finally{s.close();}
});
test('opening an old on-disk database adds tags transactionally without altering notes',()=>{
 const dir=fs.mkdtempSync(path.resolve('test-results/tag-migration-')),file=path.join(dir,'planner.sqlite');let s=new Store(file);
 try{s.addKnowledge({title:'迁移内容',content:'# 保留原文'});const old=s.snapshot();delete old.knowledge[0].tags;s.db.prepare('UPDATE planner_state SET data=? WHERE id=1').run(JSON.stringify(old));s.close();s=new Store(file);const migrated=s.snapshot();assert.deepEqual(migrated.knowledge[0],{...old.knowledge[0],tags:[]});assert.deepEqual(JSON.parse(s.db.prepare('SELECT data FROM planner_state WHERE id=1').get().data).knowledge,migrated.knowledge);}finally{s.close();}
});
