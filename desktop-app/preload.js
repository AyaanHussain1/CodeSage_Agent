// Bridges the main process (Node.js) and renderer process (webpage) safely.
// Without this, index.html/renderer.js couldn't trigger the native folder dialog.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
});
