const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const root=process.env.PLANEVERYDAY_SOURCE_ROOT||path.resolve(__dirname,'..');
function mainHarness(asyncRestore=false){
 const windows=[],calls=[],handlers=new Map();let marked=0,unread=1;
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.max=false;this.min=false;this.visible=false;this.dead=false;windows.push(this);this.webContents=Object.assign(new EventEmitter(),{send(){},setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}}});}
  loadFile(){} isDestroyed(){return this.dead;} isMaximized(){return this.max;} isMinimized(){return this.min;} isVisible(){return this.visible;}
  show(){this.visible=true;calls.push('show');} moveTop(){} focus(){calls.push('focus');}
  restore(){if(asyncRestore)this.finishRestore=()=>{this.min=false;calls.push('restore');this.emit('restore');};else{this.min=false;calls.push('restore');this.emit('restore');}}
  maximize(){this.max=true;calls.push('maximize');this.emit('maximize');}
  unmaximize(){this.max=false;calls.push('unmaximize');this.emit('unmaximize');}
  getBounds(){return {x:20,y:40,width:460,height:680};}
 }
 const app={disableHardwareAcceleration(){},setPath(){},getPath(){return 'D:/isolated-test';},setAppLogsPath(){},setAppUserModelId(){},requestSingleInstanceLock(){return true;},on(){},whenReady(){return {then(){return {catch(){}};}};}};
 const screen={getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}})};
 const fakeStore={summary:()=>({unread,settings:{},done:0}),markRead(){marked++;unread=0;}};
 const context={require(name){if(name==='electron')return {app,BrowserWindow:Window,screen,ipcMain:{on(n,f){handlers.set(n,f);},handle(){}},protocol:{registerSchemesAsPrivileged(){}},dialog:{showErrorBox(){}}};if(name==='node:path')return path;if(name==='node:fs')return {mkdirSync(){}};return {};},__dirname:path.join(root,'src'),process:{env:{PLANEVERYDAY_DATA_DIR:'D:/isolated-test'}},console,setTimeout,clearTimeout,clearInterval,fakeStore};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/main.cjs'),'utf8')+'\nstore=fakeStore;globalThis.subject={openFromPet,showMain,get toggle(){return typeof toggleMainSizeFromPet==="function"?toggleMainSizeFromPet:null;},rememberMax(value){wasMaximized=value;},setPet(value){petWindow=value;}};',context);
 return {subject:context.subject,windows,calls,handlers,marked:()=>marked};
}
test('pet double click maximizes once, returns to the same small window, and acknowledges reminders',()=>{
 const h=mainHarness();h.subject.openFromPet();const win=h.windows[0];win.emit('ready-to-show');
 assert.equal(typeof h.subject.toggle,'function','pet needs a size-toggle action');h.subject.toggle();assert.equal(win.max,true);h.subject.openFromPet();h.subject.toggle();assert.equal(win.max,false);
 assert.equal(h.windows.length,1);assert.equal(h.marked(),1);assert.equal(h.calls.filter(c=>c==='maximize').length,1);assert.equal(h.calls.filter(c=>c==='unmaximize').length,1);
});
test('pet double click restores minimized or hidden window before changing size',()=>{
 const h=mainHarness();h.subject.openFromPet();const win=h.windows[0];win.emit('ready-to-show');win.min=true;win.visible=false;h.calls.length=0;
 assert.equal(typeof h.subject.toggle,'function');h.subject.toggle();assert.equal(win.min,false);assert.equal(win.visible,true);assert.equal(win.max,true);assert(h.calls.indexOf('restore')<h.calls.indexOf('maximize'));
 win.visible=false;h.subject.toggle();assert.equal(win.visible,true);assert.equal(win.max,false);assert.equal(h.windows.length,1);
});
test('double click during renderer recreation survives ready-to-show, including repeated pairs',()=>{
 for(const previousMax of [false,true])for(const pairs of [1,2]){
  const h=mainHarness();h.subject.rememberMax(previousMax);h.subject.openFromPet();const win=h.windows[0];
  assert.equal(typeof h.subject.toggle,'function');for(let i=0;i<pairs;i++)h.subject.toggle();assert.equal(win.visible,false,'loading window must not flash at an intermediate size');
  win.emit('ready-to-show');assert.equal(win.max,pairs%2?!previousMax:previousMax);assert.equal(win.visible,true);assert.equal(h.windows.length,1);
 }
});
test('size toggle waits for asynchronous restore of a minimized maximized window',()=>{
 const h=mainHarness(true);h.subject.openFromPet();const win=h.windows[0];win.emit('ready-to-show');win.maximize();win.min=true;h.calls.length=0;
 h.subject.toggle();assert.equal(h.calls.includes('unmaximize'),false,'wait for native restoration before changing size');
 win.finishRestore();assert.equal(win.max,false);assert.equal(win.min,false);assert(h.calls.indexOf('restore')<h.calls.indexOf('unmaximize'));
});
test('only the pet renderer can request size changes through pet-action',()=>{
 const h=mainHarness();h.subject.openFromPet();const win=h.windows[0];win.emit('ready-to-show');const pet={webContents:{send(){}},isDestroyed:()=>false,isVisible:()=>true};h.subject.setPet(pet);
 const receive=h.handlers.get('pet-action');receive({sender:{}},'toggleSize');assert.equal(win.max,false);receive({sender:pet.webContents},'toggleSize');assert.equal(win.max,true);
});
test('native pet protocol routes toggle-size without repeating the ordinary open action',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:12,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});let opened=0,toggled=0;
 const context={module:{exports:{}},process:{pid:123},__dirname:path.join(root,'src'),require(name){if(name==='node:child_process')return {spawn:()=>child};return require(name);}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/native-pet.cjs'),'utf8'),context);
 new context.module.exports.NativePet({app:{isPackaged:false},screen:{dipToScreenPoint:p=>p},bounds:{x:1,y:2},onOpen(){opened++;},onToggleSize(){toggled++;},onError(){},onMove(){},onHide(){},onQuit(){}});
 child.stdout.write('{"type":"open"}\n{"type":"toggle-size"}\n');await new Promise(r=>setImmediate(r));assert.equal(opened,1);assert.equal(toggled,1);child.stdout.end();
});
test('fallback pet clicks use completed clicks; dragging and cancelled capture break the pair',()=>{
 const events={},sent=[],pet={addEventListener(n,f){events[n]=f;},setPointerCapture(){},classList:{add(){},remove(){}}};
 const context={document:{querySelector:()=>pet},window:{planner:{pet:action=>sent.push(action),onChange(){},invoke:async()=>({ok:false})}},setTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/ui/pet.js'),'utf8'),context);
 function click(detail,drag=false){events.pointerdown({button:0,pointerId:1,screenX:100,screenY:100});if(drag)events.pointermove({screenX:120,screenY:100});events.pointerup({screenX:drag?120:100,screenY:100});events.click?.({detail});}
 click(1);click(2);assert.deepEqual(sent.filter(a=>['open','toggleSize'].includes(a)),['open','toggleSize']);
 sent.length=0;click(1,true);click(2);assert.deepEqual(sent.filter(a=>['open','toggleSize'].includes(a)),['open']);
 sent.length=0;events.pointerdown({button:0,pointerId:1,screenX:100,screenY:100});events.pointercancel({});click(2);assert.deepEqual(sent.filter(a=>['open','toggleSize'].includes(a)),['open']);
});
