const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onInit:         (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('init', handler);
    return () => ipcRenderer.removeListener('init', handler);
  },
  settingsReady:  ()     => ipcRenderer.send('settings-ready'),
  browserLogin:   ()     => ipcRenderer.invoke('browser-login'),
  fetchOrgs:      (sk)   => typeof sk === 'string' ? ipcRenderer.invoke('fetch-orgs', sk) : Promise.resolve({ error: 'Invalid key' }),
  saveSettings:   (data) => ipcRenderer.send('save-settings', data),
  closeSettings:  ()     => ipcRenderer.send('close-settings'),
  resetAll:       ()     => ipcRenderer.send('reset-all'),
  openLogs:       ()     => ipcRenderer.send('open-logs'),
  telegramTest:   (token, chatId) => ipcRenderer.invoke('telegram-test', token, chatId),
  exportSettings: ()     => ipcRenderer.invoke('export-settings'),
  importSettings: ()     => ipcRenderer.invoke('import-settings'),
});
