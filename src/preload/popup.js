const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onState:         (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  popupReady:      ()   => ipcRenderer.send('popup-ready'),
  refresh:         ()   => ipcRenderer.send('refresh'),
  openSettings:    ()   => ipcRenderer.send('open-settings'),
  openLogs:        ()   => ipcRenderer.send('open-logs'),
  showContextMenu: ()   => ipcRenderer.send('show-context-menu'),
});
