const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onLogs: (cb) => ipcRenderer.on('logs', (_e, data) => cb(data)),
});
