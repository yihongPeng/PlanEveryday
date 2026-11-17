const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('planner', {
  invoke: (action, data) => ipcRenderer.invoke('planner', action, data),
  onChange: (callback) => ipcRenderer.on('state-changed', () => callback()),
  onOpenTask: (callback) => ipcRenderer.on('open-task', (_, id) => callback(id)),
  pet: (action, data) => ipcRenderer.send('pet-action', action, data)
});
