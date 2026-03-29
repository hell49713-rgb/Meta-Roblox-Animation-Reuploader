const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    installDependencies: () => ipcRenderer.invoke('install-dependencies'),
    saveCookie: (cookie) => ipcRenderer.invoke('save-cookie', cookie),
    checkSetupComplete: () => ipcRenderer.invoke('check-setup-complete'),
    minimizeWindow: () => ipcRenderer.invoke('minimize-window')
});
