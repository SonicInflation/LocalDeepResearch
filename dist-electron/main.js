import { app as n, BrowserWindow as l, ipcMain as c, dialog as P } from "electron";
import { fileURLToPath as y } from "url";
import t from "path";
const d = t.dirname(y(import.meta.url));
process.env.DIST = t.join(d, "../dist");
process.env.VITE_PUBLIC = n.isPackaged ? process.env.DIST : t.join(d, "../public");
let e = null;
const f = process.env.VITE_DEV_SERVER_URL;
function p() {
  e = new l({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: t.join(d, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !1,
      webSecurity: !1
    },
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#0a0a0f"
  }), f ? (e.loadURL(f), e.webContents.openDevTools()) : e.loadFile(t.join(process.env.DIST, "index.html")), e.on("closed", () => {
    e = null;
  });
}
n.on("window-all-closed", () => {
  process.platform !== "darwin" && n.quit();
});
n.on("activate", () => {
  l.getAllWindows().length === 0 && p();
});
n.whenReady().then(p);
c.handle("get-settings", async () => null);
c.handle("save-settings", async (w, o) => ({ success: !0, settings: o }));
c.handle("print-to-pdf", async (w, { html: o, defaultFilename: u }) => {
  const a = await import("fs"), h = await import("os"), i = await P.showSaveDialog({
    defaultPath: u,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (i.canceled || !i.filePath)
    return { success: !1, canceled: !0 };
  const s = t.join(h.tmpdir(), `ldr-pdf-${Date.now()}.html`);
  a.writeFileSync(s, o, "utf-8");
  const r = new l({
    width: 794,
    // A4 width at 96 DPI
    height: 1123,
    // A4 height at 96 DPI
    show: !1,
    webPreferences: {
      contextIsolation: !0,
      nodeIntegration: !1
    }
  });
  try {
    await r.loadFile(s), await new Promise((g) => setTimeout(g, 800));
    const m = await r.webContents.printToPDF({
      printBackground: !0,
      pageSize: "A4",
      margins: {
        top: 0.6,
        bottom: 0.8,
        left: 0.6,
        right: 0.6
      },
      generateTaggedPDF: !0
    });
    return a.writeFileSync(i.filePath, m), { success: !0, filePath: i.filePath };
  } finally {
    r.destroy();
    try {
      a.unlinkSync(s);
    } catch {
    }
  }
});
