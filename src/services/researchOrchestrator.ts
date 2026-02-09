// Research Orchestrator - Enhanced deep research workflow with massive source gathering

import type { ChatMessage } from './aiService';
import type { ResearchConfig, IntensityConfig } from '../config/settings';
import { AIService } from './aiService';
import { SearchService } from './searchService';
import { getIntensityConfig } from '../config/settings';

// Maximum characters to send in a single AI prompt (conservative for local models)
const MAX_CONTEXT_CHARS = 12000;
const MAX_SOURCE_CONTENT_CHARS = 1500;
const MAX_SYNTHESIS_BATCH = 3;

// ============================================================================
// Types
// ============================================================================

export interface ResearchSource {
    url: string;
    title: string;
    snippet: string;
    content?: string;
    relevanceScore?: number;
    keyFacts?: string[];
    fetchedAt?: Date;
}

export interface ResearchStep {
    type: 'clarifying' | 'planning' | 'searching' | 'reading' | 'synthesizing' | 'writing' | 'complete';
    message: string;
    progress?: {
        current: number;
        total: number;
        phase: string;
    };
    data?: unknown;
}

export interface ResearchReport {
    query: string;
    refinedQuery?: string;
    summary: string;
    sections: {
        title: string;
        content: string;
    }[];
    sources: ResearchSource[];
    metadata: {
        totalSources: number;
        totalSearches: number;
        researchDuration: number;
        intensity: string;
    };
    generatedAt: Date;
}

export interface ClarifyingQuestion {
    id: string;
    question: string;
    type: 'text' | 'choice' | 'confirm';
    options?: string[];
    answer?: string;
}

export interface KnowledgeGap {
    id: string;
    description: string;
    importance: number; // 1-10 scale
    suggestedQueries: string[];
}

export type ResearchProgressCallback = (step: ResearchStep) => void;

// ============================================================================
// Research Orchestrator
// ============================================================================

export class ResearchOrchestrator {
    private aiService: AIService;
    private searchService: SearchService;
    private config: ResearchConfig;
    private intensityConfig: IntensityConfig;

    constructor(
        aiService: AIService,
        searchService: SearchService,
        config: ResearchConfig
    ) {
        this.aiService = aiService;
        this.searchService = searchService;
        this.config = config;
        this.intensityConfig = getIntensityConfig(config.intensity);
    }

    updateConfig(config: ResearchConfig): void {
        this.config = config;
        this.intensityConfig = getIntensityConfig(config.intensity);
    }

    // ========================================================================
    // Main Research Flow
    // ========================================================================

    async research(
        query: string,
        onProgress: ResearchProgressCallback,
        abortSignal?: AbortSignal,
        clarifyingAnswers?: Map<string, string>
    ): Promise<ResearchReport> {
        const startTime = Date.now();
        const allSources: ResearchSource[] = [];
        const seenUrls = new Set<string>();
        let totalSearches = 0;

        // Step 1: Plan the research with query decomposition
        onProgress({
            type: 'planning',
            message: 'Decomposing research query into sub-topics...',
            progress: { current: 0, total: 100, phase: 'Planning' }
        });

        const refinedQuery = clarifyingAnswers
            ? this.incorporateClarifyingAnswers(query, clarifyingAnswers)
            : query;

        const searchPlan = await this.createSearchPlan(refinedQuery);

        if (abortSignal?.aborted) throw new Error('Research cancelled');

        // Step 2: Execute searches in parallel batches
        const totalQueries = Math.min(searchPlan.length, this.intensityConfig.maxSearchQueries);

        for (let batchStart = 0; batchStart < totalQueries; batchStart += this.intensityConfig.parallelSearches) {
            if (abortSignal?.aborted) throw new Error('Research cancelled');
            if (allSources.length >= this.intensityConfig.maxSources) break;

            const batchEnd = Math.min(batchStart + this.intensityConfig.parallelSearches, totalQueries);
            const batchQueries = searchPlan.slice(batchStart, batchEnd);

            onProgress({
                type: 'searching',
                message: `Searching batch ${Math.floor(batchStart / this.intensityConfig.parallelSearches) + 1}...`,
                progress: {
                    current: batchStart,
                    total: totalQueries,
                    phase: 'Searching'
                }
            });

            // Execute batch in parallel
            const batchResults = await Promise.all(
                batchQueries.map(q => this.searchService.search(q).catch(() => ({ results: [] })))
            );

            totalSearches += batchQueries.length;

            // Process results from this batch
            for (const result of batchResults) {
                const searchResults = (result as { results: Array<{ url: string; title: string; content: string }> }).results || [];

                for (const sr of searchResults.slice(0, this.intensityConfig.sourcesPerSearch)) {
                    if (seenUrls.has(sr.url)) continue;
                    if (allSources.length >= this.intensityConfig.maxSources) break;

                    seenUrls.add(sr.url);

                    onProgress({
                        type: 'reading',
                        message: `Reading: ${sr.title.slice(0, 60)}...`,
                        progress: {
                            current: allSources.length,
                            total: this.intensityConfig.maxSources,
                            phase: 'Reading Sources'
                        }
                    });

                    // Fetch full page content
                    const content = await this.searchService.fetchPageContent(sr.url);

                    allSources.push({
                        url: sr.url,
                        title: sr.title,
                        snippet: sr.content || '',
                        content: content || sr.content || '',
                        fetchedAt: new Date()
                    });
                }
            }
        }

        if (abortSignal?.aborted) throw new Error('Research cancelled');

        // Step 3: Score sources for relevance
        onProgress({
            type: 'synthesizing',
            message: 'Scoring source relevance...',
            progress: { current: 0, total: allSources.length, phase: 'Analyzing' }
        });

        await this.scoreSourceRelevance(refinedQuery, allSources);

        // Sort by relevance and take top sources
        allSources.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

        // Step 4: Hierarchical synthesis with adaptive iterations
        let synthesis = '';
        let iteration = 1;
        const maxIterations = this.config.enableAdaptiveResearch
            ? Math.min(this.config.maxResearchIterations, this.intensityConfig.adaptiveIterations)
            : 1;

        while (iteration <= maxIterations) {
            if (abortSignal?.aborted) throw new Error('Research cancelled');

            onProgress({
                type: 'synthesizing',
                message: iteration === 1
                    ? 'Performing initial synthesis...'
                    : `Iteration ${iteration}/${maxIterations}: Re-synthesizing with new sources...`,
                progress: {
                    current: iteration,
                    total: maxIterations,
                    phase: `Synthesis (Iteration ${iteration})`
                }
            });

            synthesis = await this.hierarchicalSynthesis(refinedQuery, allSources, onProgress, abortSignal);

            // Check if adaptive research is enabled and we have more iterations
            if (!this.config.enableAdaptiveResearch || iteration >= maxIterations) {
                break;
            }

            // Identify knowledge gaps
            onProgress({
                type: 'synthesizing',
                message: 'Analyzing research for knowledge gaps...',
                progress: {
                    current: iteration,
                    total: maxIterations,
                    phase: 'Gap Analysis'
                }
            });

            const gaps = await this.identifyKnowledgeGaps(refinedQuery, synthesis, allSources);

            // If no significant gaps, we're done
            if (gaps.length === 0) {
                onProgress({
                    type: 'synthesizing',
                    message: 'Research is comprehensive - no significant gaps found.',
                    progress: {
                        current: maxIterations,
                        total: maxIterations,
                        phase: 'Complete'
                    }
                });
                break;
            }

            onProgress({
                type: 'searching',
                message: `Found ${gaps.length} knowledge gaps. Searching for additional sources...`,
                progress: {
                    current: iteration,
                    total: maxIterations,
                    phase: 'Gap-Filling'
                }
            });

            // Search for sources to fill gaps
            const newSources = await this.searchForGaps(gaps, seenUrls, onProgress, abortSignal);

            if (newSources.length === 0) {
                // No new sources found, stop iterating
                break;
            }

            // Score new sources and add to collection
            await this.scoreSourceRelevance(refinedQuery, newSources);
            allSources.push(...newSources);
            allSources.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

            totalSearches += gaps.reduce((sum, g) => sum + g.suggestedQueries.length, 0);
            iteration++;
        }

        if (abortSignal?.aborted) throw new Error('Research cancelled');

        // Step 5: Generate comprehensive report
        onProgress({
            type: 'writing',
            message: 'Writing comprehensive research report...',
            progress: { current: 90, total: 100, phase: 'Writing Report' }
        });

        const report = await this.generateComprehensiveReport(
            query,
            refinedQuery,
            allSources,
            synthesis,
            onProgress,
            abortSignal
        );

        const duration = Math.round((Date.now() - startTime) / 1000);

        onProgress({
            type: 'complete',
            message: `Research complete! Analyzed ${allSources.length} sources in ${iteration} iteration(s) over ${Math.floor(duration / 60)}m ${duration % 60}s`,
            progress: { current: 100, total: 100, phase: 'Complete' }
        });

        return {
            ...report,
            metadata: {
                totalSources: allSources.length,
                totalSearches,
                researchDuration: duration,
                intensity: this.config.intensity
            }
        };
    }

    // ========================================================================
    // Clarifying Questions
    // ========================================================================

    async generateClarifyingQuestions(query: string): Promise<ClarifyingQuestion[]> {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are a research assistant preparing to conduct deep research. Analyze the query and generate 2-4 clarifying questions that would help focus the research. 

Return questions in this exact JSON format:
[
  {"id": "q1", "question": "...", "type": "text"},
  {"id": "q2", "question": "...", "type": "choice", "options": ["option1", "option2", "option3"]}
]

Question types:
- "text": Open-ended question
- "choice": Multiple choice (provide 2-4 options)
- "confirm": Yes/no question

Focus on:
- Scope (broad overview vs specific aspects)
- Time range (recent, historical, all-time)
- Geographic focus if relevant
- Technical depth (beginner vs expert level)
- Specific aspects of interest`
            },
            {
                role: 'user',
                content: `Research query: "${query}"\n\nGenerate clarifying questions to better understand the research needs.`
            }
        ];

        const response = await this.aiService.chat(messages);

        try {
            // Extract JSON from response
            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('Failed to parse clarifying questions:', e);
        }

        return [];
    }

    private incorporateClarifyingAnswers(query: string, answers: Map<string, string>): string {
        if (answers.size === 0) return query;

        const context = Array.from(answers.entries())
            .map(([, answer]) => answer)
            .join('. ');

        return `${query}\n\nAdditional context: ${context}`;
    }

    // ========================================================================
    // Search Planning
    // ========================================================================

    private async createSearchPlan(query: string): Promise<string[]> {
        const targetQueries = this.intensityConfig.maxSearchQueries;

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are a research planning assistant. Your task is to decompose a research query into ${targetQueries} specific search queries that will comprehensively cover the topic.

Generate queries that:
1. Cover different aspects and sub-topics
2. Include both broad and specific angles
3. Target different types of sources (academic, news, technical, etc.)
4. Explore related concepts and implications
5. Include comparison and analysis angles

Return ONLY the search queries, one per line, no numbering or extra text.`
            },
            {
                role: 'user',
                content: `Research topic: ${query}\n\nGenerate ${targetQueries} diverse search queries.`
            }
        ];

        const response = await this.aiService.chat(messages);

        const queries = response.content
            .split('\n')
            .map(q => q.trim())
            .filter(q => q.length > 0 && !q.match(/^\d+[\.\)]/))
            .slice(0, targetQueries);

        // Always include the original query first
        return [query, ...queries.filter(q => q.toLowerCase() !== query.toLowerCase())];
    }

    // ========================================================================
    // Source Analysis
    // ========================================================================

    private async scoreSourceRelevance(query: string, sources: ResearchSource[]): Promise<void> {
        // Process in batches to avoid overwhelming the AI
        const batchSize = 10;

        for (let i = 0; i < sources.length; i += batchSize) {
            const batch = sources.slice(i, i + batchSize);

            const sourceDescriptions = batch
                .map((s, idx) => `[${idx}] ${s.title}\n${s.snippet || s.content?.slice(0, 200)}`)
                .join('\n\n');

            const messages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `Rate the relevance of each source to the research query on a scale of 1-10.
Return ONLY a JSON array of numbers in order, e.g., [8, 6, 9, 4, 7]`
                },
                {
                    role: 'user',
                    content: `Query: ${query}\n\nSources:\n${sourceDescriptions}`
                }
            ];

            try {
                const response = await this.aiService.chat(messages);
                const scores = JSON.parse(response.content.match(/\[[\d,\s]+\]/)?.[0] || '[]');

                batch.forEach((source, idx) => {
                    source.relevanceScore = scores[idx] || 5;
                });
            } catch {
                // Default score if parsing fails
                batch.forEach(source => {
                    source.relevanceScore = 5;
                });
            }
        }
    }

    // ========================================================================
    // Hierarchical Synthesis
    // ========================================================================

    private async hierarchicalSynthesis(
        query: string,
        sources: ResearchSource[],
        onProgress: ResearchProgressCallback,
        abortSignal?: AbortSignal
    ): Promise<string> {
        const levels = this.intensityConfig.synthesisLevels;

        // Level 1: Summarize individual sources
        onProgress({
            type: 'synthesizing',
            message: 'Extracting key information from sources...',
            progress: { current: 0, total: levels, phase: 'Synthesis Level 1' }
        });

        const sourceSummaries = await this.summarizeSources(query, sources);

        if (abortSignal?.aborted) throw new Error('Research cancelled');
        if (levels < 2) return sourceSummaries.join('\n\n');

        // Level 2: Group by theme and synthesize
        onProgress({
            type: 'synthesizing',
            message: 'Synthesizing themes and patterns...',
            progress: { current: 1, total: levels, phase: 'Synthesis Level 2' }
        });

        const themeSynthesis = await this.synthesizeByTheme(query, sourceSummaries);

        if (abortSignal?.aborted) throw new Error('Research cancelled');
        if (levels < 3) return themeSynthesis;

        // Level 3: Cross-theme analysis
        onProgress({
            type: 'synthesizing',
            message: 'Analyzing cross-theme connections...',
            progress: { current: 2, total: levels, phase: 'Synthesis Level 3' }
        });

        const crossAnalysis = await this.crossThemeAnalysis(query, themeSynthesis);

        if (abortSignal?.aborted) throw new Error('Research cancelled');
        if (levels < 4) return crossAnalysis;

        // Level 4: Final comprehensive synthesis
        onProgress({
            type: 'synthesizing',
            message: 'Creating comprehensive synthesis...',
            progress: { current: 3, total: levels, phase: 'Synthesis Level 4' }
        });

        return await this.finalSynthesis(query, crossAnalysis, sources.length);
    }

    private async summarizeSources(query: string, sources: ResearchSource[]): Promise<string[]> {
        const summaries: string[] = [];
        const batchSize = MAX_SYNTHESIS_BATCH; // Reduced from 5

        for (let i = 0; i < sources.length; i += batchSize) {
            const batch = sources.slice(i, i + batchSize);

            const sourceTexts = batch
                .map((s, idx) => `[Source ${i + idx + 1}: ${s.title}]\n${(s.content || s.snippet).slice(0, MAX_SOURCE_CONTENT_CHARS)}`)
                .join('\n\n---\n\n');

            const messages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `Extract key facts and insights from each source relevant to the research query. For each source, provide a concise summary with the source number for citation purposes. Format: "[Source N] Key point 1. Key point 2..."`
                },
                {
                    role: 'user',
                    content: `Research query: ${query}\n\nSources:\n${sourceTexts}`
                }
            ];

            const response = await this.aiService.chat(messages);
            summaries.push(response.content);
        }

        return summaries;
    }

    private async synthesizeByTheme(query: string, sourceSummaries: string[]): Promise<string> {
        // Truncate summaries to fit context
        let totalChars = 0;
        const truncatedSummaries: string[] = [];

        for (const summary of sourceSummaries) {
            if (totalChars + summary.length > MAX_CONTEXT_CHARS) {
                // Truncate this summary to fit
                const remaining = MAX_CONTEXT_CHARS - totalChars;
                if (remaining > 500) {
                    truncatedSummaries.push(summary.slice(0, remaining) + '...');
                }
                break;
            }
            truncatedSummaries.push(summary);
            totalChars += summary.length;
        }

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `Organize the source information into coherent themes. Identify 4-7 major themes or aspects covered by the sources. For each theme, synthesize the relevant information, noting agreements, disagreements, and gaps. Maintain source citations [Source N] throughout. Be concise.`
            },
            {
                role: 'user',
                content: `Research query: ${query}\n\nSource summaries:\n${truncatedSummaries.join('\n\n')}`
            }
        ];

        const response = await this.aiService.chat(messages);
        return response.content;
    }

    private async crossThemeAnalysis(query: string, themeSynthesis: string): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `Analyze the connections between themes. Identify:
1. How themes relate to and influence each other
2. Overarching patterns or trends
3. Contradictions or tensions between themes
4. Implications and conclusions
Maintain source citations where relevant.`
            },
            {
                role: 'user',
                content: `Research query: ${query}\n\nTheme synthesis:\n${themeSynthesis.slice(0, MAX_CONTEXT_CHARS)}`
            }
        ];

        const response = await this.aiService.chat(messages);
        return response.content;
    }

    private async finalSynthesis(query: string, crossAnalysis: string, sourceCount: number): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `Create a comprehensive research synthesis that:
1. Provides an authoritative overview of the topic
2. Presents findings in a logical, flowing narrative
3. Highlights key insights and their implications
4. Notes areas of consensus and controversy
5. Identifies gaps in current knowledge
6. Maintains all source citations [Source N]

This synthesis from ${sourceCount} sources should read like an expert analysis, not a simple summary.`
            },
            {
                role: 'user',
                content: `Research query: ${query}\n\nCross-theme analysis:\n${crossAnalysis.slice(0, MAX_CONTEXT_CHARS)}`
            }
        ];

        const response = await this.aiService.chat(messages);
        return response.content;
    }

    // ========================================================================
    // Report Generation
    // ========================================================================

    private async generateComprehensiveReport(
        originalQuery: string,
        refinedQuery: string,
        sources: ResearchSource[],
        synthesis: string,
        onProgress: ResearchProgressCallback,
        abortSignal?: AbortSignal
    ): Promise<Omit<ResearchReport, 'metadata'>> {
        const sourceList = sources
            .map((s, i) => `[${i + 1}] ${s.title} (relevance: ${s.relevanceScore}/10): ${s.url}`)
            .join('\n');

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are an expert research report writer. Create a comprehensive, publication-quality research report.

Requirements:
1. **Executive Summary**: 2-3 paragraph overview of key findings
2. **Introduction**: Context and importance of the topic
3. **Methodology Note**: Brief note on research approach (${sources.length} sources analyzed)
4. **Main Findings**: 4-8 detailed sections covering major themes
5. **Analysis & Discussion**: Interpretation, implications, and critical analysis
6. **Limitations & Gaps**: What the research didn't cover
7. **Conclusions & Recommendations**: Key takeaways and future directions

Formatting:
- Use ## for section headers, ### for subsections
- Include inline citations like [1], [2], [3] referencing sources
- Use bullet points and numbered lists where appropriate
- Bold key terms and findings
- Include relevant quotes from sources when impactful

The report should be thorough (2000-4000 words), authoritative, and read like a professional research document.`
            },
            {
                role: 'user',
                content: `Research Query: ${originalQuery}
${refinedQuery !== originalQuery ? `\nRefined Query: ${refinedQuery}` : ''}

Comprehensive Synthesis:
${synthesis}

Available Sources (${sources.length} total):
${sourceList}

Write a comprehensive research report.`
            }
        ];

        if (abortSignal?.aborted) throw new Error('Research cancelled');

        // Generate the report
        let reportContent = '';

        if (this.config.enableStreaming) {
            // Stream the report generation
            const response = await this.aiService.chat(messages, (chunk) => {
                reportContent += chunk;
                onProgress({
                    type: 'writing',
                    message: 'Writing report...',
                    progress: { current: 85, total: 100, phase: 'Writing Report' },
                    data: { streamedContent: reportContent }
                });
            });
            reportContent = response.content;
        } else {
            const response = await this.aiService.chat(messages);
            reportContent = response.content;
        }

        // Parse the report into sections
        const sections = this.parseReportSections(reportContent);

        return {
            query: originalQuery,
            refinedQuery: refinedQuery !== originalQuery ? refinedQuery : undefined,
            summary: sections[0]?.content || reportContent.slice(0, 500),
            sections,
            sources,
            generatedAt: new Date()
        };
    }

    private parseReportSections(content: string): { title: string; content: string }[] {
        const sections: { title: string; content: string }[] = [];
        const lines = content.split('\n');

        let currentTitle = 'Overview';
        let currentContent: string[] = [];

        for (const line of lines) {
            const headerMatch = line.match(/^#{1,3}\s+(.+)/);
            if (headerMatch) {
                if (currentContent.length > 0) {
                    sections.push({
                        title: currentTitle,
                        content: currentContent.join('\n').trim()
                    });
                }
                currentTitle = headerMatch[1];
                currentContent = [];
            } else {
                currentContent.push(line);
            }
        }

        if (currentContent.length > 0) {
            sections.push({
                title: currentTitle,
                content: currentContent.join('\n').trim()
            });
        }

        return sections;
    }

    // ========================================================================
    // Adaptive Research Methods
    // ========================================================================

    async identifyKnowledgeGaps(
        query: string,
        synthesis: string,
        sources: ResearchSource[]
    ): Promise<KnowledgeGap[]> {
        const sourceList = sources
            .slice(0, 30)
            .map((s, i) => `[${i + 1}] ${s.title}`)
            .join('\n');

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are a research quality analyst. Analyze the synthesis and identify knowledge gaps—areas that need more information to provide a complete answer.

Return gaps in this exact JSON format:
[
  {
    "id": "gap1",
    "description": "Brief description of what's missing",
    "importance": 8,
    "suggestedQueries": ["search query 1", "search query 2"]
  }
]

Focus on:
- Missing perspectives from key players/organizations
- Unanswered sub-questions from the original query
- Areas with few or weak citations
- Contradictions that need resolution
- Recent developments not covered
- Methodological gaps

Rate importance 1-10 (10 = critical gap). Only return gaps with importance >= 5.
Return maximum 5 gaps. If research is comprehensive, return empty array [].`
            },
            {
                role: 'user',
                content: `Original query: ${query}

Current sources (${sources.length} total):
${sourceList}

Current synthesis:
${synthesis.slice(0, MAX_CONTEXT_CHARS)}

Identify knowledge gaps that should be addressed with additional research.`
            }
        ];

        try {
            const response = await this.aiService.chat(messages);
            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const gaps = JSON.parse(jsonMatch[0]) as KnowledgeGap[];
                return gaps.filter(g => g.importance >= 5);
            }
        } catch (e) {
            console.error('Failed to identify knowledge gaps:', e);
        }

        return [];
    }

    async searchForGaps(
        gaps: KnowledgeGap[],
        seenUrls: Set<string>,
        onProgress: ResearchProgressCallback,
        abortSignal?: AbortSignal
    ): Promise<ResearchSource[]> {
        const newSources: ResearchSource[] = [];
        const queriesPerGap = this.intensityConfig.gapQueriesPerIteration;

        for (let gapIdx = 0; gapIdx < gaps.length; gapIdx++) {
            const gap = gaps[gapIdx];
            const queries = gap.suggestedQueries.slice(0, queriesPerGap);

            onProgress({
                type: 'searching',
                message: `Filling gap: ${gap.description.slice(0, 50)}...`,
                progress: {
                    current: gapIdx + 1,
                    total: gaps.length,
                    phase: 'Gap-Filling Search'
                }
            });

            for (const searchQuery of queries) {
                if (abortSignal?.aborted) throw new Error('Research cancelled');

                try {
                    const result = await this.searchService.search(searchQuery);
                    const searchResults = result.results || [];

                    for (const sr of searchResults.slice(0, 3)) {
                        if (seenUrls.has(sr.url)) continue;
                        seenUrls.add(sr.url);

                        onProgress({
                            type: 'reading',
                            message: `Reading: ${sr.title.slice(0, 50)}...`,
                            progress: {
                                current: newSources.length,
                                total: gaps.length * queriesPerGap * 3,
                                phase: 'Reading Gap Sources'
                            }
                        });

                        const content = await this.searchService.fetchPageContent(sr.url);

                        newSources.push({
                            url: sr.url,
                            title: sr.title,
                            snippet: sr.content || '',
                            content: content || sr.content || '',
                            fetchedAt: new Date()
                        });
                    }
                } catch {
                    // Ignore search failures
                }
            }
        }

        return newSources;
    }
}

