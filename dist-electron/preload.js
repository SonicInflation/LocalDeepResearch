import { contextBridge as o, ipcRenderer as t } from "electron";
o.exposeInMainWorld("electronAPI", {
  getSettings: () => t.invoke("get-settings"),
  saveSettings: (e) => t.invoke("save-settings", e),
  printToPdf: (e, n) => t.invoke("print-to-pdf", { html: e, defaultFilename: n }),
  platform: process.platform
});
