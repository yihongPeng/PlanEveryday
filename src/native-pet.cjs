const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const path=require('node:path');
class NativePet {
 constructor({app,screen,bounds,onOpen,onToggleSize,onMove,onHide,onQuit,onError}) {
  this.screen=screen;this.bounds=bounds;this.visible=true;this.topmost=true;this.dead=false;this.ready=false;
  const point=screen.dipToScreenPoint(bounds);
  const executable=app.isPackaged?path.join(process.resourcesPath,'native','PlanEveryday.Pet.exe'):path.join(__dirname,'..','native','bin','PlanEveryday.Pet.exe');
  this.child=spawn(executable,['--x',String(point.x),'--y',String(point.y),'--parent-pid',String(process.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  this.pid=this.child.pid;
  this.child.stdin.on('error',()=>{});
  this.child.stderr.resume();
  createInterface({input:this.child.stdout}).on('line',line=>{
   try {const event=JSON.parse(line);
    if(event.type==='ready'){this.ready=true;this.sendState();}
    if(event.type==='status')this.status=event;
    if(event.type==='open')onOpen();
    if(event.type==='toggle-size')onToggleSize();
    if(event.type==='hide')onHide();
    if(event.type==='quit')onQuit();
    if(event.type==='move'&&Number.isFinite(event.x)&&Number.isFinite(event.y)){const p=screen.screenToDipPoint({x:event.x,y:event.y});this.bounds={...this.bounds,...p};onMove(this.bounds);}
   }catch{}
  });
  this.child.on('error',()=>{this.dead=true;onError();});
  this.child.on('exit',()=>{this.dead=true;if(!this.closing)onError();});
 }
 write(line){if(!this.dead&&this.child.stdin.writable)this.child.stdin.write(line+'\n');}
 sendState(){this.write(`state|${this.visible?1:0}|${this.topmost?1:0}|${this.unread||0}|${this.done||0}`);this.write('status');}
 setState(summary){this.unread=summary.unread;this.done=summary.done;this.sendState();}
 setAlwaysOnTop(value){this.topmost=value;this.sendState();}
 showInactive(){this.visible=true;this.sendState();}
 hide(){this.visible=false;this.sendState();}
 getBounds(){return this.bounds;}
 setBounds(bounds){this.bounds=bounds;const p=this.screen.dipToScreenPoint(bounds);this.write(`position|${p.x}|${p.y}`);}
 isDestroyed(){return this.dead;}
 isMaximized(){return false;}
 close(){this.closing=true;this.write('quit');this.child.stdin.end();}
}
module.exports={NativePet};
