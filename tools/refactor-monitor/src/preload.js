const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('refactorMonitor', {
  chooseFolder: () => ipcRenderer.invoke('monitor:choose-folder'),
  getState: () => ipcRenderer.invoke('monitor:get-state'),
  refresh: () => ipcRenderer.invoke('monitor:refresh'),
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('monitor:snapshot', listener);
    return () => ipcRenderer.removeListener('monitor:snapshot', listener);
  },
  onScanStarted: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monitor:scan-started', listener);
    return () => ipcRenderer.removeListener('monitor:scan-started', listener);
  },
  onError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monitor:error', listener);
    return () => ipcRenderer.removeListener('monitor:error', listener);
  },
});
