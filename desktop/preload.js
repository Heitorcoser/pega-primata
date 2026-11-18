// Ponte segura entre a página do jogo e o app: só expõe a detecção de VR.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopVR', {
  status: () => ipcRenderer.invoke('vr-status'),
  open: (join) => ipcRenderer.invoke('vr-open', join),
});
