import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),
    printToPdf: (html: string, defaultFilename: string) =>
        ipcRenderer.invoke('print-to-pdf', { html, defaultFilename }),
    platform: process.platform
})

declare global {
    interface Window {
        electronAPI?: {
            getSettings: () => Promise<unknown>
            saveSettings: (settings: unknown) => Promise<unknown>
            printToPdf: (html: string, defaultFilename: string) => Promise<{ success: boolean; canceled?: boolean; filePath?: string }>
            platform: string
        }
    }
}
