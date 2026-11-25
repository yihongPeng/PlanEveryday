const {testDirectory}=require('./test-paths.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Media,validateAttachments}=require('../src/media.cjs');
const {Store,validateBackup}=require('../src/store.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
test('saving enforces the same aggregate image budget as export',()=>{
 const dir=testDirectory('media-budget-'),media=new Media(dir),notes=[];
 for(let i=0;i<11;i++){const name=i.toString(16).padStart(64,'0')+'.png';const file=fs.openSync(path.join(dir,'images',name),'w');fs.ftruncateSync(file,10*1024*1024);fs.closeSync(file);notes.push({content:`![](plan-image://local/${name})`});}
 assert.doesNotThrow(()=>media.checkBudget(notes.slice(0,10)));assert.throws(()=>media.checkBudget(notes),/100 MB/);assert.doesNotThrow(()=>media.checkBudget(Array(12).fill(notes[0])));
});
test('valid backup repairs corrupt images and failed database restore rolls corrupt bytes back',()=>{
 const dir=testDirectory('media-repair-'),media=new Media(dir),s=new Store(':memory:');
 try{const url=media.add(png),name=url.split('/').pop();s.addKnowledge({title:'repair',content:`![](${url})`});const backup=media.export(s.exportBackup());fs.writeFileSync(path.join(dir,'images',name),'damaged');media.archiveCurrent(s.exportBackup(),path.join(dir,'recovery'));assert.throws(()=>media.restore(backup,()=>{throw Error('write failure');}));assert.equal(fs.readFileSync(path.join(dir,'images',name),'utf8'),'damaged');media.restore(backup,()=>s.restoreBackup(backup));assert.deepEqual(media.read(url),png);fs.unlinkSync(path.join(dir,'images',name));media.archiveCurrent(s.exportBackup(),path.join(dir,'missing-recovery'));media.restore(backup,()=>s.restoreBackup(backup));assert.deepEqual(media.read(url),png);}finally{s.close();}
});
test('images deduplicate, export referenced assets and restore to a clean directory',()=>{
 const dir=testDirectory('media-'),media=new Media(dir),s=new Store(':memory:');
 try{const url=media.add(png);assert.equal(media.add(png),url);assert.equal(fs.readdirSync(path.join(dir,'images')).length,1);s.addKnowledge({title:'图片',content:`![图](${url})`});const backup=media.export(s.exportBackup());assert.equal(backup.schemaVersion,6);validateBackup(backup);const target=new Media(path.join(dir,'restored'));target.restore(backup,()=>{});assert.deepEqual(target.read(url),png);const bad=structuredClone(backup);bad.attachments[0].data='AAAA';assert.throws(()=>validateAttachments(bad));const missing=structuredClone(backup);missing.attachments=[];assert.throws(()=>validateAttachments(missing));assert.throws(()=>media.read('plan-image://local/../../secret'));}finally{s.close();}
});
test('invalid image and failed restore cannot change current database or leave new attachments',()=>{
 const dir=testDirectory('media-fail-'),media=new Media(dir),s=new Store(':memory:');
 try{assert.throws(()=>media.add(Buffer.from('<svg/>')));assert.throws(()=>media.add(Buffer.alloc(11*1024*1024)));const url=media.add(png);s.addKnowledge({title:'图片',content:`![](${url})`});const backup=media.export(s.exportBackup());const target=new Media(path.join(dir,'target'));assert.throws(()=>target.restore(backup,()=>{throw Error('disk full');}));assert.throws(()=>target.read(url));const before=s.snapshot();const bad=structuredClone(backup);bad.attachments=[];assert.throws(()=>s.restoreBackup(bad));assert.deepEqual(s.snapshot(),before);}finally{s.close();}
});

test('v6 image backup round-trips the optional knowledge outline preference',()=>{
 const dir=testDirectory('media-toc-'),media=new Media(dir),source=new Store(':memory:'),restored=new Store(':memory:');
 try{
  const uri=media.add(png),note=source.addKnowledge({title:'图文目录',content:`# 图解\n\n![图](${uri})`,toc:true});
  const backup=media.export(source.exportBackup());assert.equal(backup.schemaVersion,6);assert.equal(backup.knowledge[0].toc,true);
  const target=new Media(path.join(dir,'target'));target.restore(backup,()=>restored.restoreBackup(backup));
  assert.deepEqual(restored.snapshot().knowledge,[note]);assert.deepEqual(target.read(uri),png);
  const bad=structuredClone(backup);bad.knowledge[0].toc='true';const before=restored.snapshot();
  assert.throws(()=>target.restore(bad,()=>restored.restoreBackup(bad)));assert.deepEqual(restored.snapshot(),before);
 }finally{source.close();restored.close();}
});
