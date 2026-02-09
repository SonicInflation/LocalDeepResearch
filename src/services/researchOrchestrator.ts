// Research Orchestrator - Enhanced deep research workflow with massive source gathering

import type { ChatMessage } from './aiService';
import type { ResearchConfig, IntensityConfig, ReportDetailLevel } from '../config/settings';
import { AIService } from './aiService';
import { SearchService } from './searchService';
import { getIntensityConfig } from '../config/settings';

// Context limits — raised for richer synthesis material
const MAX_CONTEXT_CHARS = 32000;
const MAX_SOURCE_CONTENT_CHARS = 3000;
const MAX_SYNTHESIS_BATCH = 5;

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
                    content: `You are an expert research analyst. Extract detailed, substantive information from each source relevant to the research query. For each source:
- Provide a thorough summary (3-5 sentences minimum per source)
- Include specific data points, statistics, dates, and named entities
- Quote notable or impactful statements directly
- Note the source's perspective, methodology, or authority
- Identify unique insights not found in other sources

Format: "[Source N] Detailed findings..." for each source. Do NOT be brief — thoroughness is critical.`
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
                content: `You are a senior research analyst. Organize the source information into 5-8 coherent major themes or aspects. For each theme:

1. Give it a clear, descriptive heading
2. Write 2-4 detailed paragraphs synthesizing the relevant information
3. Present specific evidence, data points, and direct quotes from sources
4. Analyze areas of agreement and disagreement between sources
5. Discuss the significance and implications of findings
6. Identify any gaps or uncertainties

Maintain source citations [Source N] throughout. Be thorough and analytical — each theme should read like a section of a professional report.`
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
                content: `You are a senior research analyst performing cross-theme analysis. Write a detailed, multi-paragraph analytical narrative that:

1. **Interconnections**: Explain in detail how the identified themes relate to, reinforce, or contradict each other. Use specific examples.
2. **Overarching Patterns**: Identify and elaborate on broad trends, shifts, or emerging patterns across all themes. Support with evidence.
3. **Contradictions & Tensions**: Explore areas of disagreement or tension between themes in depth. Analyze why these contradictions exist.
4. **Causal Relationships**: Trace cause-and-effect chains between different themes and findings.
5. **Implications & Significance**: Discuss what these patterns mean for stakeholders, policy, industry, or future developments.
6. **Emerging Questions**: Highlight important questions raised by the cross-theme analysis.

Write at least 4-6 substantial paragraphs. Maintain source citations where relevant. This should read like the analysis section of a professional research paper.`
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
                content: `You are an expert research synthesizer. Create a comprehensive, authoritative research synthesis from ${sourceCount} sources that:

1. Opens with a compelling overview establishing the topic's significance and scope
2. Presents findings as a flowing, detailed narrative organized by major themes
3. Includes specific evidence: statistics, dates, quotes, named organizations and people
4. Provides nuanced analysis of each major finding and its implications
5. Discusses areas of consensus and active controversy with balanced treatment
6. Identifies critical gaps in the current body of knowledge
7. Draws well-supported conclusions about the state of the topic
8. Maintains all source citations [Source N] throughout

This synthesis should be extensive (at least 1500-2000 words), authoritative, and read like an expert analysis commissioned by a major research institution. Do NOT summarize — analyze in depth.`
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
        const detailLevel: ReportDetailLevel = this.config.reportDetailLevel || 'detailed';

        if (detailLevel === 'standard') {
            return this.generateReportSingleShot(originalQuery, refinedQuery, sources, synthesis, onProgress, abortSignal);
        } else {
            return this.generateReportSectionBySection(originalQuery, refinedQuery, sources, synthesis, detailLevel, onProgress, abortSignal);
        }
    }

    // -- Single-shot report (legacy / standard mode) --

    private async generateReportSingleShot(
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

        let reportContent = '';

        if (this.config.enableStreaming) {
            const response = await this.aiService.chat(messages, (chunk) => {
                reportContent += chunk;
                onProgress({
                    type: 'writing',
                    message: 'Writing report...',
                    progress: { current: 85, total: 100, phase: 'Writing Report' },
                    data: { streamedContent: reportContent }
                });
            }, { maxTokens: 4096, temperature: 0.3 });
            reportContent = response.content;
        } else {
            const response = await this.aiService.chat(messages, undefined, { maxTokens: 4096, temperature: 0.3 });
            reportContent = response.content;
        }

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

    // -- Section-by-section report (detailed / comprehensive mode) --

    private async generateReportSectionBySection(
        originalQuery: string,
        refinedQuery: string,
        sources: ResearchSource[],
        synthesis: string,
        detailLevel: ReportDetailLevel,
        onProgress: ResearchProgressCallback,
        abortSignal?: AbortSignal
    ): Promise<Omit<ResearchReport, 'metadata'>> {
        const sourceList = sources
            .map((s, i) => `[${i + 1}] ${s.title} (relevance: ${s.relevanceScore}/10): ${s.url}`)
            .join('\n');

        const isComprehensive = detailLevel === 'comprehensive';
        const sectionTokenBudget = isComprehensive ? 8192 : 6144;
        const minSections = isComprehensive ? 7 : 5;
        const maxSections = isComprehensive ? 12 : 8;

        // Step 1: Generate report outline
        onProgress({
            type: 'writing',
            message: 'Planning report structure...',
            progress: { current: 80, total: 100, phase: 'Planning Report' }
        });

        if (abortSignal?.aborted) throw new Error('Research cancelled');

        const outlineMessages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are an expert research report planner. Given a research synthesis and source list, create a detailed report outline.

Generate ${minSections}-${maxSections} section titles with a 1-2 sentence description of what each section should cover. The report should follow this general structure but adapt to the topic:

1. Executive Summary
2. Introduction & Background
3. Methodology Note
4-${maxSections - 3}. Main findings sections (each covering a distinct theme or aspect)
${maxSections - 2}. Analysis & Discussion (cross-cutting analysis)
${maxSections - 1}. Limitations & Gaps
${maxSections}. Conclusions & Recommendations

Return ONLY a JSON array in this exact format:
[
  {"title": "Executive Summary", "description": "Overview of key findings..."},
  {"title": "Introduction", "description": "Context and importance..."},
  ...
]`
            },
            {
                role: 'user',
                content: `Research Query: ${originalQuery}

Synthesis highlights (for planning):
${synthesis.slice(0, 8000)}

Number of sources: ${sources.length}

Generate the report outline as a JSON array.`
            }
        ];

        let outline: { title: string; description: string }[] = [];
        try {
            const outlineResponse = await this.aiService.chat(outlineMessages, undefined, { maxTokens: 2048, temperature: 0.3 });
            const jsonMatch = outlineResponse.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                outline = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('Failed to parse report outline:', e);
        }

        // Fallback outline if parsing failed
        if (outline.length < 3) {
            outline = [
                { title: 'Executive Summary', description: 'Comprehensive overview of all key findings and their significance' },
                { title: 'Introduction', description: 'Context, background, and importance of the research topic' },
                { title: 'Methodology Note', description: `Research approach and methodology, analyzing ${sources.length} sources` },
                { title: 'Main Findings', description: 'Detailed presentation of primary research findings organized by theme' },
                { title: 'Key Trends & Developments', description: 'Important trends, patterns, and recent developments in the field' },
                { title: 'Stakeholder Perspectives', description: 'Different viewpoints and positions from key stakeholders' },
                { title: 'Analysis & Discussion', description: 'Cross-cutting analysis, implications, and critical interpretation' },
                { title: 'Limitations & Gaps', description: 'Areas not covered, data limitations, and remaining questions' },
                { title: 'Conclusions & Recommendations', description: 'Key takeaways, actionable recommendations, and future directions' }
            ];
        }

        // Step 2: Generate each section individually
        const allSections: { title: string; content: string }[] = [];
        let fullReportSoFar = '';

        for (let i = 0; i < outline.length; i++) {
            if (abortSignal?.aborted) throw new Error('Research cancelled');

            const section = outline[i];
            const sectionProgress = Math.round(82 + (i / outline.length) * 15);

            onProgress({
                type: 'writing',
                message: `Writing section ${i + 1}/${outline.length}: ${section.title}...`,
                progress: { current: sectionProgress, total: 100, phase: `Writing: ${section.title}` }
            });

            const isExecSummary = section.title.toLowerCase().includes('executive summary');
            const isMethodology = section.title.toLowerCase().includes('methodology');

            let sectionPrompt: string;

            if (isExecSummary) {
                // Executive summary is written last (after all other sections), but placed first
                // We'll generate a placeholder and replace it at the end
                allSections.push({ title: section.title, content: '__EXEC_SUMMARY_PLACEHOLDER__' });
                continue;
            } else if (isMethodology) {
                sectionPrompt = `Write the "${section.title}" section for this research report.

Section goal: ${section.description}

This is a methodology/approach note for a report analyzing ${sources.length} sources across multiple search queries and synthesis iterations. Describe the systematic research approach: automated search query decomposition, source gathering, relevance scoring, hierarchical synthesis, and cross-theme analysis.

Write 2-3 paragraphs. Use a professional, academic tone.`;
            } else {
                sectionPrompt = `Write the "${section.title}" section for this research report. This is section ${i + 1} of ${outline.length}.

Section goal: ${section.description}

Research Query: ${originalQuery}

Research Synthesis (use this as your primary source material):
${synthesis.slice(0, MAX_CONTEXT_CHARS)}

Available Sources for citation (cite as [N]):
${sourceList}

${fullReportSoFar.length > 0 ? `\nPrevious sections already written (do NOT repeat this content, build upon it):\n${fullReportSoFar.slice(-4000)}` : ''}

Requirements for this section:
- Write ${isComprehensive ? '4-8' : '3-5'} detailed, substantive paragraphs
- Include specific facts, data points, statistics, dates, and named entities from the synthesis
- Use inline citations [1], [2], etc. referencing the source numbers above
- Include direct quotes where impactful
- Use ### for any subsections within this section
- Use bullet points or numbered lists where they add clarity
- Bold key terms and important findings
- Maintain a professional, authoritative tone throughout
- Do NOT include the section title as a header (it will be added automatically)
- Do NOT write content for other sections — focus only on "${section.title}"

Write this section now with full detail and depth.`;
            }

            const sectionMessages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `You are an expert research report writer producing a publication-quality research document. Write detailed, thorough, and analytically rigorous content. Every paragraph should contain substantive information supported by evidence and citations. Never produce placeholder or filler text. Your writing should match the quality and depth of reports produced by top-tier research institutions.`
                },
                {
                    role: 'user',
                    content: sectionPrompt
                }
            ];

            let sectionContent = '';

            if (this.config.enableStreaming) {
                const response = await this.aiService.chat(sectionMessages, (chunk) => {
                    sectionContent += chunk;
                    // Stream the full report assembled so far
                    const assembledReport = this.assembleReportForStream(originalQuery, allSections, sectionContent, section.title, sourceList, sources);
                    onProgress({
                        type: 'writing',
                        message: `Writing section ${i + 1}/${outline.length}: ${section.title}...`,
                        progress: { current: sectionProgress, total: 100, phase: `Writing: ${section.title}` },
                        data: { streamedContent: assembledReport }
                    });
                }, { maxTokens: sectionTokenBudget, temperature: 0.3 });
                sectionContent = response.content;
            } else {
                const response = await this.aiService.chat(sectionMessages, undefined, { maxTokens: sectionTokenBudget, temperature: 0.3 });
                sectionContent = response.content;
            }

            allSections.push({ title: section.title, content: sectionContent.trim() });
            fullReportSoFar += `\n\n## ${section.title}\n${sectionContent.trim()}`;
        }

        // Step 3: Generate executive summary from the full report
        const execSummaryIdx = allSections.findIndex(s => s.content === '__EXEC_SUMMARY_PLACEHOLDER__');
        if (execSummaryIdx !== -1) {
            if (abortSignal?.aborted) throw new Error('Research cancelled');

            onProgress({
                type: 'writing',
                message: 'Writing executive summary...',
                progress: { current: 97, total: 100, phase: 'Executive Summary' }
            });

            const summaryMessages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `You are an expert research report writer. Write a comprehensive executive summary for the following research report. The executive summary should:

1. Be 3-4 substantial paragraphs
2. Highlight the most important findings, trends, and implications
3. Mention key data points and statistics
4. Note major areas of consensus and controversy
5. Preview the report's conclusions and recommendations
6. Be self-contained — a reader should understand the key takeaways from this alone
7. Include relevant source citations [N]

Write with authority and precision. This should read like the executive summary of a major research institution's report.`
                },
                {
                    role: 'user',
                    content: `Research Query: ${originalQuery}

Full report content:
${fullReportSoFar.slice(0, MAX_CONTEXT_CHARS)}

Write the executive summary.`
                }
            ];

            let execContent = '';
            if (this.config.enableStreaming) {
                const response = await this.aiService.chat(summaryMessages, (chunk) => {
                    execContent += chunk;
                    allSections[execSummaryIdx] = { title: allSections[execSummaryIdx].title, content: execContent };
                    const assembledReport = this.assembleReportForStream(originalQuery, allSections, '', '', sourceList, sources);
                    onProgress({
                        type: 'writing',
                        message: 'Writing executive summary...',
                        progress: { current: 98, total: 100, phase: 'Executive Summary' },
                        data: { streamedContent: assembledReport }
                    });
                }, { maxTokens: 4096, temperature: 0.3 });
                execContent = response.content;
            } else {
                const response = await this.aiService.chat(summaryMessages, undefined, { maxTokens: 4096, temperature: 0.3 });
                execContent = response.content;
            }

            allSections[execSummaryIdx] = { title: allSections[execSummaryIdx].title, content: execContent.trim() };
        }

        // Step 4: Generate references section from sources
        const referencesContent = sources
            .map((s, i) => `[${i + 1}] ${s.title} (relevance: ${s.relevanceScore}/10): ${s.url}`)
            .join('\n');

        allSections.push({ title: 'References', content: referencesContent });

        // Use the executive summary as the report summary, or the first section content
        const summarySection = allSections.find(s =>
            s.title.toLowerCase().includes('executive summary') ||
            s.title.toLowerCase().includes('summary')
        );

        return {
            query: originalQuery,
            refinedQuery: refinedQuery !== originalQuery ? refinedQuery : undefined,
            summary: summarySection?.content || allSections[0]?.content || '',
            sections: allSections,
            sources,
            generatedAt: new Date()
        };
    }

    // Helper: assemble the full report markdown for streaming preview
    private assembleReportForStream(
        query: string,
        completedSections: { title: string; content: string }[],
        currentSectionContent: string,
        currentSectionTitle: string,
        _sourceList: string,
        sources: ResearchSource[]
    ): string {
        let report = `# ${query}\n\n## Comprehensive Research Report\n\n---\n\n`;

        for (const section of completedSections) {
            if (section.content === '__EXEC_SUMMARY_PLACEHOLDER__') continue;
            report += `## ${section.title}\n\n${section.content}\n\n---\n\n`;
        }

        if (currentSectionContent) {
            report += `## ${currentSectionTitle}\n\n${currentSectionContent}\n\n`;
        }

        // Add sources summary at the bottom
        report += `\n\n## Sources\n\n`;
        const topSources = sources.slice(0, 20);
        for (let i = 0; i < topSources.length; i++) {
            report += `[${i + 1}] ${topSources[i].title}: ${topSources[i].url}\n`;
        }
        if (sources.length > 20) {
            report += `\n... and ${sources.length - 20} more sources\n`;
        }

        return report;
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

