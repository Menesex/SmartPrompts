// Puente seguro entre la ventana (renderer) y el proceso principal.
// El renderer solo ve estas funciones; nunca toca Node, la red ni la API key.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smartprompts', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  testConnection: () => ipcRenderer.invoke('test-connection'),
  transcribe: (arrayBuffer) => ipcRenderer.invoke('transcribe', arrayBuffer),
  capture: () => ipcRenderer.invoke('capture'),
  send: (payload) => ipcRenderer.invoke('send', payload),
  copy: (payload) => ipcRenderer.invoke('copy', payload),
  hide: () => ipcRenderer.invoke('hide'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  quit: () => ipcRenderer.invoke('quit'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, msg, kind) => cb(msg, kind)),
});
