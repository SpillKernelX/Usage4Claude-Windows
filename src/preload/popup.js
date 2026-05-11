const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onState:         (cb) => {
    const handler = (_e, s) => cb(s);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
  popupReady:      ()   => ipcRenderer.send('popup-ready'),
  refresh:         ()   => ipcRenderer.send('refresh'),
  openSettings:    ()   => ipcRenderer.send('open-settings'),
  openLogs:        ()   => ipcRenderer.send('open-logs'),
  showContextMenu: ()   => ipcRenderer.send('show-context-menu'),
  hidePopup:       ()   => ipcRenderer.send('hide-popup'),
  setShowRemaining:(val) => ipcRenderer.send('set-show-remaining', !!val),
  pauseNotifications:(ms) => ipcRenderer.send('pause-notifications', ms),
  setCompactMode:  (val) => ipcRenderer.send('set-compact-mode', !!val),
  setPinPopup:     (val) => ipcRenderer.send('set-pin-popup', !!val),
});
