'use strict'

// The only surface the desktop UI can call into the main process.
// extension/ui/bridge.js turns this into the same interface the browser
// extension pages use.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yoinksDesktop', {
  send: command => ipcRenderer.send('yoinks:command', command),
  onState: callback => {
    ipcRenderer.on('yoinks:state', (_event, view) => callback(view))
  },
  readLegal: name => ipcRenderer.invoke('yoinks:legal', name),
  openExternal: url => ipcRenderer.send('yoinks:open-external', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  version: ipcRenderer.sendSync('yoinks:version'),
})
