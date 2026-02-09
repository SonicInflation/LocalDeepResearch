// Configuration types and settings management for Local Deep Research

export type AIProviderType = 'lmstudio' | 'ollama' | 'openai-compatible';

export type ResearchIntensity = 'quick' | 'standard' | 'deep' | 'comprehensive' | 'exhaustive';

export interface AIProviderConfig {
    type: AIProviderType;
    endpoint: string;
    model: string;
    apiKey?: string;
}

export interface SearchConfig {
    searxngUrl: string;
    maxResults: number;
    engines?: string[];
}

export interface ResearchConfig {
    intensity: ResearchIntensity;
    enableClarifyingQuestions: boolean;
    enableStreaming: boolean;
    enableAdaptiveResearch: boolean;
    maxResearchIterations: number;
}

export interface AppSettings {
    aiProvider: AIProviderConfig;
    search: SearchConfig;
    research: ResearchConfig;
}

// Intensity level configurations
export interface IntensityConfig {
    maxSources: number;
    maxSearchQueries: number;
    parallelSearches: number;
    sourcesPerSearch: number;
    synthesisLevels: number;
    estimatedMinutes: [number, number]; // [min, max]
    adaptiveIterations: number; // default max iterations for adaptive mode
    gapQueriesPerIteration: number; // searches per gap-filling round
}

export const INTENSITY_CONFIGS: Record<ResearchIntensity, IntensityConfig> = {
    quick: {
        maxSources: 10,
        maxSearchQueries: 5,
        parallelSearches: 2,
        sourcesPerSearch: 3,
        synthesisLevels: 1,
        estimatedMinutes: [2, 5],
        adaptiveIterations: 1,
        gapQueriesPerIteration: 2
    },
    standard: {
        maxSources: 25,
        maxSearchQueries: 10,
        parallelSearches: 3,
        sourcesPerSearch: 5,
        synthesisLevels: 2,
        estimatedMinutes: [5, 15],
        adaptiveIterations: 2,
        gapQueriesPerIteration: 3
    },
    deep: {
        maxSources: 50,
        maxSearchQueries: 20,
        parallelSearches: 4,
        sourcesPerSearch: 5,
        synthesisLevels: 3,
        estimatedMinutes: [15, 25],
        adaptiveIterations: 3,
        gapQueriesPerIteration: 4
    },
    comprehensive: {
        maxSources: 100,
        maxSearchQueries: 35,
        parallelSearches: 5,
        sourcesPerSearch: 6,
        synthesisLevels: 4,
        estimatedMinutes: [30, 50],
        adaptiveIterations: 3,
        gapQueriesPerIteration: 5
    },
    exhaustive: {
        maxSources: 200,
        maxSearchQueries: 50,
        parallelSearches: 5,
        sourcesPerSearch: 8,
        synthesisLevels: 4,
        estimatedMinutes: [45, 90],
        adaptiveIterations: 4,
        gapQueriesPerIteration: 6
    }
};

export const DEFAULT_SETTINGS: AppSettings = {
    aiProvider: {
        type: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'llama3.2',
        apiKey: ''
    },
    search: {
        searxngUrl: 'http://localhost:8080',
        maxResults: 10,
        engines: []
    },
    research: {
        intensity: 'standard',
        enableClarifyingQuestions: true,
        enableStreaming: true,
        enableAdaptiveResearch: true,
        maxResearchIterations: 3
    }
};

const STORAGE_KEY = 'local-deep-research-settings';

export function loadSettings(): AppSettings {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Migrate old settings format
            if (parsed.research?.synthesisDepth && !parsed.research?.intensity) {
                parsed.research.intensity = parsed.research.synthesisDepth;
                delete parsed.research.synthesisDepth;
            }
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

export function getIntensityConfig(intensity: ResearchIntensity): IntensityConfig {
    return INTENSITY_CONFIGS[intensity];
}

export function getEndpointForProvider(config: AIProviderConfig): string {
    switch (config.type) {
        case 'lmstudio':
            return config.endpoint.endsWith('/v1')
                ? config.endpoint
                : `${config.endpoint}/v1`;
        case 'ollama':
            return config.endpoint;
        case 'openai-compatible':
            return config.endpoint;
        default:
            return config.endpoint;
    }
}
