import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
    ? process.env.DIST
    : path.join(__dirname, '../public')

let mainWindow: BrowserWindow | null = null
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false
        },
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        backgroundColor: '#0a0a0f'
    })

    if (VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(VITE_DEV_SERVER_URL)
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
    }

    mainWindow.on('closed', () => {
        mainWindow = null
    })
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(createWindow)

// IPC handlers for settings persistence
ipcMain.handle('get-settings', async () => {
    // Settings will be stored in renderer localStorage for simplicity
    return null
})

ipcMain.handle('save-settings', async (_event, settings) => {
    // Settings will be stored in renderer localStorage for simplicity
    return { success: true, settings }
})

// PDF export via native Chromium renderer (selectable text + clickable links)
ipcMain.handle('print-to-pdf', async (_event, { html, defaultFilename }: { html: string; defaultFilename: string }) => {
    const fs = await import('fs')
    const os = await import('os')

    // Show save dialog first so user can pick location
    const result = await dialog.showSaveDialog({
        defaultPath: defaultFilename,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })

    if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
    }

    // Write HTML to a temp file — loading via file:// preserves PDF link annotations
    // (data: URLs can cause Chromium to strip hyperlinks from printToPDF output)
    const tmpFile = path.join(os.tmpdir(), `ldr-pdf-${Date.now()}.html`)
    fs.writeFileSync(tmpFile, html, 'utf-8')

    // Create a hidden window to render the HTML
    const pdfWindow = new BrowserWindow({
        width: 794,   // A4 width at 96 DPI
        height: 1123, // A4 height at 96 DPI
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    })

    try {
        // Load from file:// URL to preserve link annotations
        await pdfWindow.loadFile(tmpFile)

        // Wait for layout to settle
        await new Promise(resolve => setTimeout(resolve, 800))

        // Generate PDF with native Chromium renderer
        const pdfBuffer = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: {
                top: 0.6,
                bottom: 0.8,
                left: 0.6,
                right: 0.6
            },
            generateTaggedPDF: true
        })

        // Write the PDF file
        fs.writeFileSync(result.filePath, pdfBuffer)

        return { success: true, filePath: result.filePath }
    } finally {
        pdfWindow.destroy()
        // Clean up temp file
        try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
    }
})

