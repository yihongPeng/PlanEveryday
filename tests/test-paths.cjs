'use strict';
const fs=require('node:fs'),path=require('node:path');
// Never inherit the user's Windows TEMP drive for application fixtures or child caches.
const testResults=path.resolve(__dirname,'..','test-results');
if(process.platform==='win32'&&path.parse(testResults).root.toLowerCase()!=='d:\\')throw Error('请在 D 盘项目目录中运行测试');
fs.mkdirSync(testResults,{recursive:true});
const testTemp=path.join(testResults,'temp');fs.mkdirSync(testTemp,{recursive:true});
process.env.TEMP=process.env.TMP=testTemp;
function testDirectory(prefix){
 if(typeof prefix!=='string'||!prefix||!/^[a-z0-9-]+$/i.test(prefix))throw Error('测试目录前缀无效');
 return fs.mkdtempSync(path.join(testResults,prefix));
}
module.exports={testResults,testDirectory};
