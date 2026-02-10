import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { fileURLToPath } from "url";
import path from "path";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname$1, "../public");
let mainWindow = null;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f0f23"
  });
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(process.env.DIST, "index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(createWindow);
ipcMain.handle("get-settings", async () => {
  return null;
});
ipcMain.handle("save-settings", async (_event, settings) => {
  return { success: true, settings };
});
ipcMain.handle("print-to-pdf", async (_event, { html, defaultFilename }) => {
  const fs = await import("fs");
  const os = await import("os");
  const result = await dialog.showSaveDialog({
    defaultPath: defaultFilename,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }
  const tmpFile = path.join(os.tmpdir(), `ldr-pdf-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, "utf-8");
  const pdfWindow = new BrowserWindow({
    width: 794,
    // A4 width at 96 DPI
    height: 1123,
    // A4 height at 96 DPI
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  try {
    await pdfWindow.loadFile(tmpFile);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        top: 0.6,
        bottom: 0.8,
        left: 0.6,
        right: 0.6
      }
    });
    fs.writeFileSync(result.filePath, pdfBuffer);
    return { success: true, filePath: result.filePath };
  } finally {
    pdfWindow.destroy();
    try {
      fs.unlinkSync(tmpFile);
    } catch {
    }
  }
});
