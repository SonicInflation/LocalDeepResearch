import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  printToPdf: (html, defaultFilename) => ipcRenderer.invoke("print-to-pdf", { html, defaultFilename }),
  platform: process.platform
});
