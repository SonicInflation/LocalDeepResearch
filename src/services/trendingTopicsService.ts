const CACHE_KEY = 'local-deep-research-trending';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface TrendingCache {
    topics: string[];
    fetchedAt: number;
}

const FALLBACK_TOPICS = [
    "What are the latest developments in quantum computing?",
    "Compare the pros and cons of Rust vs Go for backend development",
    "How does mRNA vaccine technology work?",
    "What are the environmental impacts of electric vehicles?",
    "Explain the current state of nuclear fusion research"
];

function loadCache(): TrendingCache | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as TrendingCache;
    } catch {
        return null;
    }
}

function saveCache(topics: string[]): void {
    try {
        const cache: TrendingCache = { topics, fetchedAt: Date.now() };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function fetchTrendingFromSearxng(searxngUrl: string): Promise<string[]> {
    const url = new URL('/search', searxngUrl);
    url.searchParams.set('q', '!news trending today');
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', 'news');

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const results: { title: string }[] = data.results || [];

    if (results.length === 0) throw new Error('No results');

    // Take top 15 results, pick 5 diverse ones
    const titles = results
        .slice(0, 15)
        .map(r => r.title.trim())
        .filter(t => t.length > 10 && t.length < 120);

    return shuffle(titles).slice(0, 5);
}

export interface TrendingResult {
    topics: string[];
    isTrending: boolean; // true = live from SearXNG, false = fallback
}

export async function getTrendingTopics(searxngUrl: string): Promise<TrendingResult> {
    const cache = loadCache();
    const cacheValid = cache && (Date.now() - cache.fetchedAt < CACHE_TTL_MS);

    if (cacheValid && cache) {
        return { topics: shuffle(cache.topics).slice(0, 5), isTrending: true };
    }

    try {
        const topics = await fetchTrendingFromSearxng(searxngUrl);
        saveCache(topics);
        return { topics, isTrending: true };
    } catch {
        // Return stale cache if available, otherwise fallback
        if (cache && cache.topics.length > 0) {
            return { topics: shuffle(cache.topics).slice(0, 5), isTrending: true };
        }
        return { topics: FALLBACK_TOPICS, isTrending: false };
    }
}
