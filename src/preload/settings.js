const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onInit:               (cb)   => ipcRenderer.on('init',                 (_e, d) => cb(d)),
  onBrowserLoginResult: (cb)   => ipcRenderer.on('browser-login-result', (_e, r) => cb(r)),
  onFetchOrgsResult:    (cb)   => ipcRenderer.on('fetch-orgs-result',    (_e, r) => cb(r)),
  settingsReady:  ()     => ipcRenderer.send('settings-ready'),
  browserLogin:   ()     => ipcRenderer.send('browser-login'),
  fetchOrgs:      (sk)   => { if (typeof sk === 'string') ipcRenderer.send('fetch-orgs', sk); },
  saveSettings:   (data) => ipcRenderer.send('save-settings', data),
  closeSettings:  ()     => ipcRenderer.send('close-settings'),
  resetAll:       ()     => ipcRenderer.send('reset-all'),
  openLogs:       ()     => ipcRenderer.send('open-logs'),
});
