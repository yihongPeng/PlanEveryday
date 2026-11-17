const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, Notification, dialog, screen, powerMonitor, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store, validateBackup } = require('./store.cjs');
const { NativePet } = require('./native-pet.cjs');
const { Startup } = require('./startup.cjs');
// This local text UI does not need a persistent hardware GPU context.
// Native pet transparency is rendered independently by Windows.
if(process.env.PLANEVERYDAY_HARDWARE_RENDER!=='1') app.disableHardwareAcceleration();

if (process.env.PLANEVERYDAY_DATA_DIR) app.setPath('userData', process.env.PLANEVERYDAY_DATA_DIR);
else {const directory='D:\\PlanEverydayData';try{fs.mkdirSync(directory,{recursive:true});app.setPath('userData',directory);}catch(error){dialog.showErrorBox('无法打开 D 盘数据目录','请确认 D 盘可用且可写：'+directory+'。为保护数据，程序不会切换到 C 盘创建空库。');app.exit(1);}}
const appId = process.env.PLANEVERYDAY_DATA_DIR ? 'local.PlanEveryday.QA' : 'local.PlanEveryday.Desktop';
app.setAppUserModelId(appId);
let mainWindow, petWindow, tray, store, quitting = false, timer, dragOrigin, notifications = new Set();
let suspendTimer, boundsTimer, uiSession = null, pendingTaskId = null, wasMaximized = false;
let petError = false;
let startup,startupError='';
const suspendMs = process.env.PLANEVERYDAY_DATA_DIR && process.env.PLANEVERYDAY_SUSPEND_MS ? Math.max(300, Number(process.env.PLANEVERYDAY_SUSPEND_MS)) : 10000;
const testWithoutFocus = !!process.env.PLANEVERYDAY_DATA_DIR && process.env.PLANEVERYDAY_TEST_NO_FOCUS==='1';
const ui = name => path.join(__dirname, 'ui', name);
const iconPath = path.join(__dirname, '..', 'assets', 'app.png');
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', (_event,argv) => {if(!argv?.includes('--autostart'))showMain();});
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('芽芽计划无法启动', error.message); app.quit(); });
}
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; clearInterval(timer); clearTimeout(suspendTimer); clearTimeout(boundsTimer); petWindow?.close(); });
app.on('will-quit', () => { try { store?.close(); } catch {} });

function visibleBounds(bounds, fallback) {
  const b = { ...fallback, ...bounds };
  const display = screen.getDisplayMatching({ x: Math.round(b.x), y: Math.round(b.y), width: b.width, height: b.height });
  const area = display.workArea;
  b.width = Math.min(b.width, area.width); b.height = Math.min(b.height, area.height);
  b.x = Math.max(area.x, Math.min(Math.round(b.x), area.x + area.width - b.width));
  b.y = Math.max(area.y, Math.min(Math.round(b.y), area.y + area.height - b.height));
  return b;
}
function showMain(id) {
  clearTimeout(suspendTimer);
  if(id)pendingTaskId=id;
  if (!mainWindow || mainWindow.isDestroyed()) { createMain(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if(testWithoutFocus)mainWindow.showInactive();else{mainWindow.show();mainWindow.focus();}
  mainWindow.webContents.send('state-changed');
}
function broadcast() {
  for (const w of [mainWindow, petWindow]) if (w && !w.isDestroyed() && w.webContents && (w !== mainWindow || w.isVisible())) w.webContents.send('state-changed');
  if (petWindow?.setState) petWindow.setState(store.summary());
}
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
}
function updatePet() {
  const s = store.summary().settings;
  petWindow.setAlwaysOnTop(s.petAlwaysOnTop);
  if (s.petVisible) petWindow.showInactive(); else petWindow.hide();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开芽芽计划', click: () => showMain() },
    { label: s.petVisible ? '隐藏桌宠' : '显示桌宠', click: () => { store.setSettings({ petVisible: !s.petVisible }); if(!s.petVisible&&petWindow.isDestroyed()) createPet(); updatePet(); broadcast(); } },
    { label: '免打扰', type: 'checkbox', checked: s.doNotDisturb, click: item => { store.setSettings({ doNotDisturb: item.checked }); updatePet(); broadcast(); } },
    { type: 'separator' },
    { label: '退出（退出后不再提醒）', click: () => app.quit() }
  ]));
  petWindow.setState?.(store.summary());
}
function notify(title, body, taskId) {
  if (!Notification.isSupported()) { notificationFailed=true;notificationStatus='系统不支持通知，请查看提醒记录';return; }
  const n = new Notification({ title, body, icon: iconPath, silent: true });
  notifications.add(n);
  n.on('show',()=>{notificationStatus='系统已接收通知（实际展示受专注模式影响）';notificationFailed=false;broadcast();});
  n.on('click', () => {notifications.delete(n);showMain(taskId);});
  n.on('close', () => notifications.delete(n));
  n.on('failed', () => { notifications.delete(n); notificationFailed = true;notificationStatus='发送失败，请检查 Windows 通知设置'; broadcast(); });
  n.show();
}
let notificationFailed = false, notificationStatus='尚未验证系统通知展示，可发送测试提醒', lastPoll = Date.now();
function poll(compensation = false) {
  try {
    const now = Date.now();
    const missed = compensation || now - lastPoll > 20000; lastPoll = now;
    const events = store.pollReminders(now);
    if (!events.length) return;
    broadcast();
    if (store.summary().settings.doNotDisturb) return;
    if (missed || events.length > 1) notify('有计划等待你查看', `${events.length} 项计划到了提醒时间，方便时再来看看。`);
    else notify('芽芽提醒你', events[0].title, events[0].taskId);
  } catch (error) { console.error('Reminder scan failed:', error.code || error.name); }
}
function createMain() {
  const settings = store.summary().settings;
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({ ...visibleBounds(settings.windowBounds, { x: area.x + Math.round((area.width - 460) / 2), y: area.y + 50, width: 460, height: 680 }), minWidth: 360, minHeight: 480, title: '芽芽计划', icon: iconPath, frame: false, backgroundColor: '#F6F5F1', show: false, focusable:!testWithoutFocus, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  secureWindow(mainWindow);
  mainWindow.loadFile(ui('index.html'));
  const window = mainWindow;
  mainWindow.once('ready-to-show', () => { if(wasMaximized) window.maximize(); showMain(); });
  mainWindow.on('close', e => {
    if (quitting) return;
    e.preventDefault(); mainWindow.hide();
    if (!store.summary().settings.closeHintSeen) {
      store.setSettings({ closeHintSeen: true });
      notify('芽芽还在这里', '窗口已收起。点击桌宠或托盘图标即可回来；右键托盘可退出。');
    }
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(async () => {
      if(window.isDestroyed() || window.isVisible()) return;
      try {
        const session = await window.webContents.executeJavaScript('window.captureSessionState ? window.captureSessionState() : null');
        if(!session || window.isDestroyed() || window.isVisible()) return;
        uiSession=session; wasMaximized=window.isMaximized();clearTimeout(boundsTimer);
        if(!wasMaximized) store.setSettings({windowBounds:window.getBounds()});
        window.destroy(); if(mainWindow===window) mainWindow=null;
      } catch { /* Keep the hidden renderer if its unsaved session cannot be captured. */ }
    }, suspendMs);
  });
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isMaximized() && !window.isMinimized()) store.setSettings({ windowBounds: window.getBounds() });
    }, 350);
  };
  mainWindow.on('resize', saveBounds); mainWindow.on('move', saveBounds);
  mainWindow.on('maximize', broadcast); mainWindow.on('unmaximize', broadcast);
}
function createPet() {
  const settings=store.summary().settings, area=screen.getPrimaryDisplay().workArea;
  const bounds=visibleBounds(settings.petPosition,{x:area.x+area.width-146,y:area.y+area.height-150,width:116,height:132});
  if(process.platform==='win32' && process.env.PLANEVERYDAY_WEB_PET!=='1') {
    petError=false;
    petWindow=new NativePet({app,screen,bounds,onOpen:()=>showMain(),onMove:position=>store.setSettings({petPosition:position}),onHide:()=>{store.setSettings({petVisible:false});updatePet();broadcast();},onQuit:()=>app.quit(),onError:()=>{petError=true;broadcast();}});
    return;
  }
  petWindow = new BrowserWindow({ ...visibleBounds(settings.petPosition, { x: area.x + area.width - 146, y: area.y + area.height - 150, width: 116, height: 132 }), width: 116, height: 132, transparent: true, frame: false, resizable: false, skipTaskbar: true, hasShadow: false, focusable: false, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  secureWindow(petWindow); petWindow.loadFile(ui('pet.html'));
  petWindow.once('ready-to-show', updatePet);
}
async function start() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  if(app.isPackaged && !process.env.PLANEVERYDAY_DATA_DIR) {
    const shortcut={target:process.execPath,cwd:path.dirname(process.execPath),icon:process.execPath,iconIndex:0,description:'芽芽计划 · 个人计划与记背',appUserModelId:appId};
    const menuDir=path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs');
    fs.mkdirSync(menuDir,{recursive:true});
    shell.writeShortcutLink(path.join(menuDir,'芽芽计划.lnk'),'create',shortcut);
    shell.writeShortcutLink(path.join(app.getPath('desktop'),'芽芽计划.lnk'),'create',shortcut);
  }
  if(!process.env.PLANEVERYDAY_DATA_DIR){const {migrateData,migrationSources}=require('./data-location.cjs');migrateData(app.getPath('userData'),migrationSources(app.getPath('home')));}
  store = new Store(path.join(app.getPath('userData'), 'planner.sqlite'));
  startup=new Startup({app,directory:app.getPath('userData'),supported:process.platform==='win32'&&app.isPackaged&&!process.env.PLANEVERYDAY_DATA_DIR});
  try{startup.migrate();}catch{startupError='开机自启路径更新失败，请关闭后重新开启此选项。';}
  if(!process.argv.includes('--autostart'))createMain(); createPet();
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 }));
  tray.setToolTip('芽芽计划 · 点击打开你的今天'); tray.on('click', () => showMain());
  updatePet();
  for (const event of ['display-removed', 'display-metrics-changed']) screen.on(event, () => {
    for (const w of [mainWindow, petWindow]) if (w && !w.isDestroyed() && !w.isMaximized()) w.setBounds(visibleBounds(w.getBounds(), w.getBounds()));
  });
  powerMonitor.on('resume', () => poll(true));
  poll(true); timer = setInterval(() => poll(), 3000);
}

const actions = {
  snapshot: () => ({ ...store.snapshot(), startup:{...startup.status(),migrationError:startupError}, maximized: mainWindow?.isMaximized()||false, notificationSupported: Notification.isSupported(), notificationFailed,notificationStatus,petError, dataPath: app.getPath('userData'), session:uiSession,requestedTaskId:pendingTaskId, pet:{native:petWindow instanceof NativePet,pid:petWindow?.pid,ready:petWindow?.ready,visible:petWindow?.visible,status:petWindow?.status,bounds:petWindow?.getBounds()} }),
  'task:ack':id=>{if(pendingTaskId===id)pendingTaskId=null;},
  'notification:test':()=>{if(store.summary().settings.doNotDisturb)throw Error('当前开启免打扰，请关闭后再测试系统通知。');notificationStatus='已请求系统通知，等待结果';notify('芽芽计划 · 测试提醒','看到这条通知，说明系统提醒通道已工作。点击可以返回计划。');return true;},
  'session:restored': () => {uiSession=null;},
  'knowledge:add': data => store.addKnowledge(data),
  'knowledge:update': data => store.updateKnowledge(data.id,data.patch),
  'knowledge:delete': async ({id}) => {const result=await dialog.showMessageBox(mainWindow,{type:'question',buttons:['保留内容','删除知识点'],defaultId:0,cancelId:0,message:'删除这个知识点？',detail:'删除后无法撤销。',noLink:true});if(result.response!==1)return false;store.deleteKnowledge(id);return true;},
  confirmDiscard: async () => (await dialog.showMessageBox(mainWindow,{type:'question',buttons:['继续编辑','放弃修改'],defaultId:0,cancelId:0,message:'放弃尚未保存的修改？',noLink:true})).response===1,
  add: data => store.addTask(data),
  update: data => store.updateTask(data.id, data.patch),
  delete: async ({ id }) => {
    const answer = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['保留任务', '删除任务'], defaultId: 0, cancelId: 0, message: '删除这项任务？', detail: '删除后无法撤销。', noLink: true });
    if (answer.response !== 1) return false;
    store.deleteTask(id); return true;
  },
  focus: data => store.toggleFocus(data.id, data.replaceId),
  schedule: data => store.scheduleTasks(data.ids, data.date),
  undoSchedule: data => store.undoSchedule(data),
  readEvents: () => store.markRead(),
  'startup:set': ({enabled}) => {const result=startup.set(enabled);startupError='';return result;},
  settings: data => { store.setSettings(data); if(data.petVisible&&petWindow.isDestroyed())createPet();updatePet(); return true; },
  maximize: () => { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); return true; },
  minimize: () => mainWindow.minimize(),
  hide: () => mainWindow.close(),
  quit: () => app.quit(),
  export: async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { title: '导出计划备份', defaultPath: `芽芽计划-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: '计划备份', extensions: ['json'] }] });
    if (canceled) return false;
    fs.writeFileSync(filePath, JSON.stringify(store.exportBackup(), null, 2), 'utf8'); return true;
  },
  import: async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: '恢复计划备份', filters: [{ name: '计划备份', extensions: ['json'] }], properties: ['openFile'] });
    if (canceled) return false;
    if (fs.statSync(filePaths[0]).size > 20 * 1024 * 1024) throw Error('备份文件过大，最大支持 20 MB。');
    const backup = validateBackup(JSON.parse(fs.readFileSync(filePaths[0], 'utf8')));
    const answer = await dialog.showMessageBox(mainWindow, { type: 'warning', message: `恢复 ${backup.tasks.length} 项任务和 ${backup.knowledge?.length||0} 个知识点？`, detail: '将替换当前任务和全部记背内容，旧版备份没有记背内容时将清空当前记背。恢复前会自动保留当前数据备份；过去的提醒不会重新弹出。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return false;
    const folder = path.join(app.getPath('userData'), 'backups'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `before-restore-${Date.now()}.json`), JSON.stringify(store.exportBackup()), 'utf8');
    store.restoreBackup(backup); updatePet(); return true;
  },
  openLink: ({url}) => {const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw Error('仅支持打开 http 或 https 网页链接');return shell.openExternal(parsed.href);},
  openDataFolder: () => shell.openPath(app.getPath('userData'))
};
ipcMain.handle('planner', async (event, action, data) => {
  if (![mainWindow?.webContents, petWindow?.webContents].includes(event.sender)) return { ok: false, error: '未知窗口' };
  if (event.sender === petWindow?.webContents && action !== 'snapshot') return { ok: false, error: '无权执行' };
  if (!Object.hasOwn(actions, action)) return { ok: false, error: '不支持的操作' };
  try { const result = await actions[action](data); if (action !== 'snapshot') broadcast(); return { ok: true, data: result }; }
  catch (error) { return { ok: false, error: error.message || '操作失败，请重试。' }; }
});
ipcMain.on('pet-action', (event, action, data) => {
  if (event.sender !== petWindow?.webContents) return;
  if (action === 'open') showMain();
  if (action === 'menu') tray.popUpContextMenu();
  if (action === 'dragStart') dragOrigin = { cursor: screen.getCursorScreenPoint(), bounds: petWindow.getBounds() };
  if (action === 'drag' && dragOrigin) {
    const cursor = screen.getCursorScreenPoint();
    petWindow.setPosition(dragOrigin.bounds.x + cursor.x - dragOrigin.cursor.x, dragOrigin.bounds.y + cursor.y - dragOrigin.cursor.y);
  }
  if (action === 'dragEnd') {
    dragOrigin = null; petWindow.setBounds(visibleBounds(petWindow.getBounds(), petWindow.getBounds()));
    store.setSettings({ petPosition: petWindow.getBounds() });
  }
});
