import type { ResearchReport } from './researchOrchestrator';

export interface ResearchSession {
    id: string;
    query: string;
    report: ResearchReport;
    activityLog: string[];
    createdAt: Date;
}

const DB_NAME = 'LocalDeepResearchDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

class HistoryService {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }

    async saveSession(session: Omit<ResearchSession, 'id' | 'createdAt'>): Promise<string> {
        await this.init();

        const fullSession: ResearchSession = {
            ...session,
            id: crypto.randomUUID(),
            createdAt: new Date()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(fullSession);

            request.onsuccess = () => resolve(fullSession.id);
            request.onerror = () => reject(request.error);
        });
    }

    async getSessions(): Promise<ResearchSession[]> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const sessions = request.result as ResearchSession[];
                // Sort by createdAt descending (newest first)
                sessions.sort((a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
                resolve(sessions);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getSession(id: string): Promise<ResearchSession | null> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteSession(id: string): Promise<void> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clearAll(): Promise<void> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

export const historyService = new HistoryService();
