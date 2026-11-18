'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const MAX_IMAGE=10*1024*1024,MAX_TOTAL=100*1024*1024,MAX_BACKUP=150*1024*1024;
const pattern=/^plan-image:\/\/local\/([a-f0-9]{64}\.png)$/;
const hash=b=>createHash('sha256').update(b).digest('hex')+'.png';
function checkPNG(b){
 if(!Buffer.isBuffer(b)||b.length>MAX_IMAGE||b.length<33||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.toString('ascii',12,16)!=='IHDR')throw Error('图片无效，或超过 10 MB 限制');
 const w=b.readUInt32BE(16),h=b.readUInt32BE(20);if(!w||!h||w*h>25000000)throw Error('图片尺寸过大，最多支持 2500 万像素');
 return b;
}
function references(knowledge){const ids=new Set();for(const k of knowledge||[])for(const m of k.content.matchAll(/plan-image:\/\/local\/([a-f0-9]{64}\.png)/g))ids.add(m[1]);return ids;}
function saveBackup(file,backup){
 if(process.platform==='win32'&&path.parse(path.resolve(file)).root.toLowerCase()!=='d:\\')throw Error('请将备份保存到 D 盘');
 const content=JSON.stringify(backup);if(Buffer.byteLength(content)>MAX_BACKUP)throw Error('备份文件超过 150 MB');
 fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,content,{encoding:'utf8',flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function validateAttachments(backup){
 const refs=references(backup.knowledge),items=backup.attachments||[];
 if(!Array.isArray(items)||items.length>10000||(backup.schemaVersion===4&&!Array.isArray(backup.attachments)))throw Error('图片附件格式不正确');
 const found=new Map();let total=0;
 for(const item of items){
  if(!item||typeof item.name!=='string'||!/^[a-f0-9]{64}\.png$/.test(item.name)||found.has(item.name)||typeof item.data!=='string'||item.data.length>Math.ceil(MAX_IMAGE/3)*4||!(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(item.data))throw Error('图片附件格式不正确');
  const bytes=checkPNG(Buffer.from(item.data,'base64'));if(hash(bytes)!==item.name)throw Error('图片附件校验失败');
  total+=bytes.length;if(total>MAX_TOTAL)throw Error('备份图片总量超过 100 MB');found.set(item.name,bytes);
 }
 for(const name of refs)if(!found.has(name))throw Error('备份缺少图片附件，未恢复任何数据');
 return found;
}
class Media{
 constructor(directory){this.directory=path.join(directory,'images');fs.mkdirSync(this.directory,{recursive:true});}
 add(bytes){checkPNG(bytes);const name=hash(bytes);this.write(name,bytes);return 'plan-image://local/'+name;}
 write(name,bytes){const file=path.join(this.directory,name);if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(bytes))throw Error('已有图片校验失败，请恢复完整备份');return false;}const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,bytes,{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}return true;}
 read(url){const match=pattern.exec(url);if(!match)throw Error('无效图片地址');const bytes=checkPNG(fs.readFileSync(path.join(this.directory,match[1])));if(hash(bytes)!==match[1])throw Error('图片校验失败');return bytes;}
 checkBudget(knowledge){let total=0;for(const name of references(knowledge)){total+=fs.statSync(path.join(this.directory,name)).size;if(total>MAX_TOTAL)throw Error('笔记图片总量不能超过 100 MB，请移除部分图片后保存');}}
 archiveCurrent(backup,folder){
  // Recovery must work even when the current library has missing/corrupt images.
  // Preserve readable originals verbatim; this is an emergency archive, not an import file.
  fs.mkdirSync(path.join(folder,'images'),{recursive:true});const missing=[];
  for(const name of references(backup.knowledge)){try{fs.copyFileSync(path.join(this.directory,name),path.join(folder,'images',name));}catch(error){if(error.code==='ENOENT')missing.push(name);else throw error;}}
  saveBackup(path.join(folder,'recovery-state.json'),{format:'PlanEveryday-emergency-archive',backup,missingImages:missing});
 }
 export(backup){const attachments=[...references(backup.knowledge)].map(name=>({name,data:this.read('plan-image://local/'+name).toString('base64')}));const result={...backup,schemaVersion:4,attachments};validateAttachments(result);return result;}
 restore(backup,commit,decode=()=>{}){
  const files=validateAttachments(backup);for(const bytes of files.values())decode(bytes);const changed=[];
  try{for(const [name,bytes] of files){const file=path.join(this.directory,name);let previous=null;
   if(fs.existsSync(file)){if(fs.readFileSync(file).equals(bytes))continue;previous=file+'.damaged-'+randomUUID();fs.renameSync(file,previous);}
   changed.push({file,previous});this.write(name,bytes);
  }return commit();}catch(error){for(const {file,previous} of changed.reverse()){if(fs.existsSync(file))fs.unlinkSync(file);if(previous)fs.renameSync(previous,file);}throw error;}
 }
}
module.exports={Media,validateAttachments,MAX_IMAGE,MAX_BACKUP,checkPNG,saveBackup};
