import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),
    platform: process.platform
})

declare global {
    interface Window {
        electronAPI?: {
            getSettings: () => Promise<unknown>
            saveSettings: (settings: unknown) => Promise<unknown>
            platform: string
        }
    }
}
