// Search Service - Handles SearXNG integration for web search

import type { SearchConfig } from '../config/settings';

export interface SearchResult {
    title: string;
    url: string;
    content: string;
    engine?: string;
    score?: number;
}

export interface SearchResponse {
    query: string;
    results: SearchResult[];
    suggestions?: string[];
}

export class SearchService {
    private config: SearchConfig;

    constructor(config: SearchConfig) {
        this.config = config;
    }

    updateConfig(config: SearchConfig): void {
        this.config = config;
    }

    async search(query: string): Promise<SearchResponse> {
        const url = new URL('/search', this.config.searxngUrl);
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('categories', 'general');

        if (this.config.engines && this.config.engines.length > 0) {
            url.searchParams.set('engines', this.config.engines.join(','));
        }

        const response = await fetch(url.toString());

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        const results: SearchResult[] = (data.results || [])
            .slice(0, this.config.maxResults)
            .map((r: { title: string; url: string; content: string; engine?: string; score?: number }) => ({
                title: r.title,
                url: r.url,
                content: r.content || '',
                engine: r.engine,
                score: r.score
            }));

        return {
            query: data.query || query,
            results,
            suggestions: data.suggestions
        };
    }

    async fetchPageContent(url: string): Promise<string> {
        try {
            // Use a simple fetch - in production you might want a more robust solution
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Local Deep Research Bot'
                }
            });

            if (!response.ok) {
                return '';
            }

            const html = await response.text();

            // Basic HTML to text extraction
            const textContent = this.extractTextFromHTML(html);

            // Limit content length
            return textContent.slice(0, 10000);
        } catch (error) {
            console.error(`Failed to fetch page content from ${url}:`, error);
            return '';
        }
    }

    private extractTextFromHTML(html: string): string {
        // Remove script and style elements
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

        // Remove HTML tags
        text = text.replace(/<[^>]+>/g, ' ');

        // Decode HTML entities
        text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // Clean up whitespace
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    }

    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            const response = await fetch(`${this.config.searxngUrl}/search?q=test&format=json`);
            if (response.ok) {
                return { success: true, message: 'SearXNG connection successful' };
            }
            return { success: false, message: `HTTP ${response.status}` };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Connection failed'
            };
        }
    }
}
