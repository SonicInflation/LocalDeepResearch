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
    private aiModel: string;
    private searchEngine: string;

    constructor(
        aiService: AIService,
        searchService: SearchService,
        config: ResearchConfig,
        aiModel: string = 'Local LLM',
        searchEngine: string = 'SearXNG'
    ) {
        this.aiService = aiService;
        this.searchService = searchService;
        this.config = config;
        this.aiModel = aiModel;
        this.searchEngine = searchEngine;
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

        // Step 5: Deduplicate synthesis
        onProgress({
            type: 'synthesizing',
            message: 'Consolidating and deduplicatng synthesis...',
            progress: { current: 85, total: 100, phase: 'Deduplication' }
        });

        const finalSynthesis = await this.deduplicateSynthesis(refinedQuery, synthesis);

        // Step 6: Generate comprehensive report
        onProgress({
            type: 'writing',
            message: 'Writing comprehensive research report...',
            progress: { current: 90, total: 100, phase: 'Writing Report' }
        });

        const report = await this.generateComprehensiveReport(
            query,
            refinedQuery,
            allSources,
            finalSynthesis,
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
- provide a thorough summary (3-5 sentences minimum per source)
- include specific technical specifications, data points, statistics, dates, and named entities
- identify specific vendors, tools, or technologies mentioned (e.g., Yoti, AWS, specialized ML models)
- quote notable or impactful statements directly
- note the source's perspective, methodology, or authority
- identify unique insights not found in other sources
- explain technical mechanisms (how things work) rather than just stating they exist

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
3. Present specific evidence: technical specs, implementation details, data points, and direct quotes
4. Analyze areas of agreement and disagreement between sources
5. Discuss the significance and implications of findings, specifically focusing on technical impact
6. Identify any gaps or technical uncertainties

Maintain source citations [Source N] throughout. Be thorough and analytical — each theme should read like a section of a professional technical report. Avoid repeating the same high-level facts across multiple themes; if a fact is central to multiple themes, consolidate it in the most relevant one and reference it in others.`
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

    private async deduplicateSynthesis(query: string, synthesis: string): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are a research editor. Your task is to take a comprehensive research synthesis and remove verbatim repetitions while preserving all technical details, data points, and citations.

Guidelines:
1. Identify facts or points that are stated nearly identically in multiple places.
2. Merge these repeated points into a single, well-structured explanation in the most relevant section.
3. Replace subsequent repetitions with a brief reference to the main explanation.
4. Ensure all source citations [Source N] are preserved.
5. Maintain the professional, analytical tone of the original content.
6. Do NOT remove unique insights or varied perspectives on the same topic—only remove redundant restatements of the same basic fact.
7. Focus specifically on deduplicating "high-impact" facts like major breaches, specific vendor names, or key statistics that tend to be overused as context "anchors".
8. Pay special attention to repeated statistics, numbers, named individuals, and specific examples. If a specific statistic, number, or named data point (e.g. petition signature counts, substory counts) appears in more than two sections, keep it in the most relevant section only. All other mentions should reference it indirectly without restating the number. Named quotes should appear exactly once in the entire report.
9. Check for contradictory statistics across sections. If two sections cite different numbers for the same thing (e.g. one says 101 original substories, another says 119), flag the discrepancy and use the number from the most authoritative source. Do not present conflicting stats as if they are both true.

Goal: Create a tighter, more professional narrative that flows logically without giving the reader a sense of deja vu.`
            },
            {
                role: 'user',
                content: `Research query: ${query}\n\nExisting synthesis to deduplicate:\n${synthesis.slice(0, MAX_CONTEXT_CHARS)}`
            }
        ];

        const response = await this.aiService.chat(messages, undefined, { maxTokens: 4096, temperature: 0.2 });
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

        // Filter out very low-relevance sources (score < 2/10) to remove only true noise
        const filteredSources = sources.filter(s => (s.relevanceScore || 0) >= 2);
        // Fall back to all sources if filtering would leave too few
        const reportSources = filteredSources.length >= 10 ? filteredSources : sources;

        if (detailLevel === 'standard') {
            return this.generateReportSingleShot(originalQuery, refinedQuery, reportSources, synthesis, onProgress, abortSignal);
        } else {
            return this.generateReportSectionBySection(originalQuery, refinedQuery, reportSources, synthesis, detailLevel, onProgress, abortSignal);
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
2. **Methodology Note**: Brief note on research approach (${sources.length} sources analyzed)
3. **Main Findings**: 4-8 detailed sections, each covering a DISTINCT theme (no overlap between sections)
4. **Cross-Cutting Analysis**: How themes interconnect — do NOT restate individual findings
5. **Recommendations & Future Outlook**: Actionable items and future directions — do NOT recap findings

IMPORTANT: Do NOT include an "Introduction" section (the Executive Summary provides context). Do NOT include a "Conclusions" section that summarizes findings. Each section must contribute NEW content not found in other sections.

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

1. Executive Summary (mandatory — written last, provides a self-contained overview)
2. Methodology Note (brief — 1-2 paragraphs on research approach)
3-${maxSections - 2}. Main findings sections (each covering a DISTINCT theme or aspect — no two sections should cover the same topic)
${maxSections - 1}. Cross-Cutting Analysis (ONLY analyze connections and tensions BETWEEN themes — do not restate findings from earlier sections)
${maxSections}. Recommendations & Future Outlook (ONLY actionable items and forward-looking projections — do not recap findings)

IMPORTANT structural rules:
- Do NOT include an "Introduction" or "Introduction & Background" section — the Executive Summary already provides context.
- Do NOT include a "Conclusions" section that summarizes findings — use "Recommendations & Future Outlook" for forward-looking content only.
- Do NOT include a "Limitations & Gaps" section — integrate any limitations into the relevant findings sections.
- Each main findings section must cover a DISTINCT aspect with no overlap with other sections.
- CRITICAL: No two sections should discuss the same events, decisions, or criticisms. If there are 3 main controversies, each gets ONE dedicated section — do NOT create separate sections that revisit the same controversy from a different angle (e.g., "Content Removals" and "Fan Disappointment about Content" would be overlapping). A section on fan reception should cover NEW reactions not discussed in topic-specific sections.
- Do NOT create a "Fan Sentiment" or "Community Response" section that simply re-discusses controversies already covered in earlier sections. If fan reactions are part of a controversy, include them in that controversy's section.

Return ONLY a JSON array in this exact format:
[
  {"title": "Executive Summary", "description": "Overview of key findings..."},
  {"title": "Methodology Note", "description": "Research approach..."},
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

                // Sanitize: remove Introduction-type sections the LLM may have included despite instructions
                outline = outline.filter(s => {
                    const lower = s.title.toLowerCase();
                    if (lower === 'introduction' || lower === 'introduction & background' || lower === 'background & introduction' || lower === 'introduction and background') {
                        return false;
                    }
                    if (lower === 'limitations & gaps' || lower === 'limitations and gaps' || lower === 'limitations') {
                        return false;
                    }
                    return true;
                });

                // Sanitize: rename recap-style sections
                outline = outline.map(s => {
                    const lower = s.title.toLowerCase();
                    if (lower.includes('conclusion') && lower.includes('recommendation')) {
                        return { title: 'Recommendations & Future Outlook', description: 'Specific actionable recommendations and forward-looking projections — do NOT summarize previous sections' };
                    }
                    if (lower === 'analysis & discussion' || lower === 'analysis and discussion') {
                        return { title: 'Cross-Cutting Analysis', description: 'Connections and tensions between themes — do not restate individual findings' };
                    }
                    return s;
                });

                // Deduplicate: remove sections with duplicate titles (keep first occurrence)
                const seenTitles = new Set<string>();
                outline = outline.filter(s => {
                    const lower = s.title.toLowerCase();
                    if (seenTitles.has(lower)) return false;
                    seenTitles.add(lower);
                    return true;
                });
            }
        } catch (e) {
            console.error('Failed to parse report outline:', e);
        }

        // Fallback outline if parsing failed
        if (outline.length < 3) {
            outline = [
                { title: 'Executive Summary', description: 'Comprehensive overview of all key findings and their significance' },
                { title: 'Methodology Note', description: `Research approach and methodology, analyzing ${sources.length} sources` },
                { title: 'Main Findings', description: 'Detailed presentation of primary research findings organized by theme' },
                { title: 'Key Trends & Developments', description: 'Important trends, patterns, and recent developments in the field' },
                { title: 'Stakeholder Perspectives', description: 'Different viewpoints and positions from key stakeholders' },
                { title: 'Cross-Cutting Analysis', description: 'Connections and tensions BETWEEN the themes above — do not restate individual findings, analyze how they interact' },
                { title: 'Recommendations & Future Outlook', description: 'Specific actionable recommendations and forward-looking projections — do NOT summarize previous sections' }
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

            const isCrossCutting = section.title.toLowerCase().includes('cross-cutting');
            const isRecommendations = section.title.toLowerCase().includes('recommendation') || section.title.toLowerCase().includes('future outlook');
            const needsCompressedInput = isCrossCutting || isRecommendations;

            let sectionPrompt: string;

            if (isExecSummary) {
                // Executive summary is written last (after all other sections), but placed first
                // We'll generate a placeholder and replace it at the end
                allSections.push({ title: section.title, content: '__EXEC_SUMMARY_PLACEHOLDER__' });
                continue;
            } else if (isMethodology) {
                sectionPrompt = `Write the "${section.title}" section for this research report.

Section goal: ${section.description}

This is a methodology/approach note for a report analyzing ${sources.length} sources. 

Describe the systematic research approach using the following technical details:
- LLM Pipeline: Local deep research powered by "${this.aiModel}"
- Search Infrastructure: High-diversity gathering via SearXNG (${this.searchEngine})
- Process: Automated multi-stage workflow including query decomposition, source relevance scoring, hierarchical synthesis (up to 4 levels), cross-theme analysis, and a specialized deduplication/consolidation pass.
- Verification: Source citations [N] are used throughout to ground all claims in the collected material.

Write 2-3 paragraphs. Use a professional, technical tone. Be honest about the local nature of the implementation.`;
            } else if (needsCompressedInput) {
                // Cross-Cutting Analysis and Recommendations get a FRESH context window
                // with compressed section summaries instead of the full report text.
                // This prevents context window exhaustion that causes empty/skeletal output.
                const compressedSummaries = await this.compressSectionsForAnalysis(allSections, abortSignal);

                if (isCrossCutting) {
                    sectionPrompt = `You are writing the Cross-Cutting Analysis section for a research report.

Research Query: ${originalQuery}

Below are compressed summaries of each report section written so far:

${compressedSummaries}

Available Sources for citation (cite as [N]):
${sourceList}

Your job is NOT to re-summarize these sections. Instead:
- Identify connections between themes that weren't obvious in individual sections
- Surface contradictions or tensions between different stakeholders
- Note patterns that emerge only when viewing all themes together
- Analyze how the different controversies interact and amplify each other

Requirements:
- Write ${isComprehensive ? '4-6' : '3-4'} substantial, analytically rigorous paragraphs
- Each paragraph should make a DISTINCT analytical point about cross-theme connections
- Use inline citations [N] where relevant
- Do NOT restate individual findings — analyze how they INTERACT
- Do NOT include the section title as a header (it will be added automatically)
- Do NOT end with generic platitudes about ethics, transparency, or the gaming industry

Write this section now.`;
                } else {
                    sectionPrompt = `You are writing the Recommendations & Future Outlook section for a research report.

Research Query: ${originalQuery}

Below are compressed summaries of each report section written so far:

${compressedSummaries}

Available Sources for citation (cite as [N]):
${sourceList}

Your job is to provide SPECIFIC, ACTIONABLE recommendations and forward-looking projections. Do NOT summarize or recap findings from earlier sections.

Requirements:
- Write ${isComprehensive ? '4-6' : '3-4'} substantial paragraphs
- Each recommendation must be SPECIFIC and ACTIONABLE (not generic advice like "be more transparent")
- Include concrete steps, timelines, or examples where possible
- Reference specific issues from the summaries but do NOT re-explain them
- Include forward-looking industry implications
- Use inline citations [N] where relevant
- Do NOT include the section title as a header (it will be added automatically)
- Do NOT end with generic platitudes

Write this section now.`;
                }
            } else {
                // Regular body sections: use full synthesis + knowledge registry
                const knowledgeRegistry = await this.extractKnowledgeRegistry(allSections);

                sectionPrompt = `Write the "${section.title}" section for this research report. This is section ${i + 1} of ${outline.length}.

Section goal: ${section.description}

Research Query: ${originalQuery}

Research Synthesis (use this as your primary source material):
${synthesis.slice(0, MAX_CONTEXT_CHARS)}

Available Sources for citation (cite as [N]):
${sourceList}

${knowledgeRegistry.length > 0 ? `\nCore Facts Already Covered (do NOT restate these detailed facts, instead reference them if needed and move to new depth):\n${knowledgeRegistry}` : ''}

${fullReportSoFar.length > 0 ? `\nPrevious sections already written (do NOT repeat this content, build upon it):\n${fullReportSoFar.slice(-8000)}` : ''}

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
- CRITICAL ANTI-REPETITION RULES:
  1. If a fact, statistic, quote, or argument appears in the "Core Facts Already Covered" registry or in the previous sections above, do NOT restate it. Instead, use a brief reference like "As discussed earlier..." or "Building on the [topic] outlined above..." and immediately move to NEW analysis, angles, or evidence.
  2. Each section MUST contribute substantively new information or analysis not found in any previous section. If you find yourself writing a paragraph that covers the same ground as a previous section, stop and find a different angle.
  3. Do NOT re-introduce the same examples, quotes, or statistics even with different wording — paraphrased repetition is still repetition.
  4. Structural sections (Introduction, Analysis, Conclusions) naturally touch similar themes — differentiate them by depth: Introduction sets context, Analysis provides critical evaluation, Conclusions synthesizes implications. Do NOT use any of these sections to simply re-summarize findings already presented.
- NO SUMMARY RECAPS OR GENERIC CLOSINGS: Do not end with a summary paragraph that restates what you just covered. Do NOT end with generic closing sentences about "transparency," "ethical practices," "broader concerns about the gaming industry," "erosion of trust," or similar platitudes — these become repetitive across sections. End each section with either (a) a concrete new data point or quote, or (b) a specific transition to the next topic. NEVER end with a sentence that could be copy-pasted to any other section.

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

            // Strip duplicate header if the LLM included the section title as a leading header
            let cleanedContent = sectionContent.trim();
            const headerPatterns = [
                new RegExp(`^#{1,3}\\s*${section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\n`, 'i'),
                new RegExp(`^\\*\\*${section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*\\s*\n`, 'i'),
            ];
            for (const pattern of headerPatterns) {
                cleanedContent = cleanedContent.replace(pattern, '');
            }

            allSections.push({ title: section.title, content: cleanedContent });
            fullReportSoFar += `\n\n## ${section.title}\n${cleanedContent}`;
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

        // Step 4: Post-generation deduplication pass
        onProgress({
            type: 'writing',
            message: 'Deduplicating report sections...',
            progress: { current: 95, total: 100, phase: 'Deduplication' }
        });
        await this.deduplicateReportSections(allSections, originalQuery, abortSignal);

        // Step 5: Generate references section from sources
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

    private async extractKnowledgeRegistry(completedSections: { title: string; content: string }[]): Promise<string> {
        if (completedSections.length === 0) return '';

        // Use ALL completed sections to build the registry — prevents facts from early sections being re-explained
        const recentContent = completedSections
            .filter(s => s.content !== '__EXEC_SUMMARY_PLACEHOLDER__')
            .map(s => `[${s.title}]\n${s.content}`)
            .join('\n\n');

        if (!recentContent) return '';

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are a research coordinator. Extract a bulleted list of "Core Facts" that have already been explained in detail in the provided report sections.
Focus on:
- Specific data points and statistics (e.g., petition signature counts, percentages, dates)
- Key technical mechanisms (e.g., vendor names like Yoti, specific ML models)
- Major incidents (e.g., specific data breaches, casting controversies)
- Specific named entities (people, organizations, campaigns)
- Direct quotes that have already been used
- Specific narrative points or arguments already made

Goal: Provide a comprehensive registry of facts that should NOT be explained again in detail. Later sections should only reference these briefly (e.g., "As noted earlier..." or "the previously discussed...") and focus on NEW analysis or angles.`
            },
            {
                role: 'user',
                content: `Report sections so far:\n${recentContent.slice(0, 12000)}`
            }
        ];

        try {
            const response = await this.aiService.chat(messages, undefined, { maxTokens: 1024, temperature: 0.2 });
            return response.content;
        } catch {
            return '';
        }
    }

    /**
     * Programmatic sentence-level deduplication using 4-gram overlap detection.
     * Catches both proper-noun repetition AND descriptive phrase repetition
     * (e.g., "stilted facial expressions", "erosion of trust").
     */
    /**
     * Compress completed body sections into bullet-point summaries for use by
     * Cross-Cutting Analysis and Recommendations sections. This gives those
     * sections a fresh context window instead of consuming leftover tokens.
     */
    private async compressSectionsForAnalysis(
        sections: { title: string; content: string }[],
        abortSignal?: AbortSignal
    ): Promise<string> {
        const bodySections = sections.filter(s =>
            s.content !== '__EXEC_SUMMARY_PLACEHOLDER__' &&
            !s.title.toLowerCase().includes('methodology') &&
            !s.title.toLowerCase().includes('executive summary') &&
            !s.title.toLowerCase().includes('cross-cutting') &&
            !s.title.toLowerCase().includes('recommendation')
        );

        const summaries: string[] = [];

        for (const section of bodySections) {
            if (abortSignal?.aborted) throw new Error('Research cancelled');

            const compressMessages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `Summarize the following report section in 3-5 bullet points. Capture ONLY: key claims, specific data points (numbers, dates, names), and cited sources [N]. Keep under 200 tokens total.`
                },
                {
                    role: 'user',
                    content: `Section: "${section.title}"\n\n${section.content}`
                }
            ];

            try {
                const response = await this.aiService.chat(compressMessages, undefined, { maxTokens: 256, temperature: 0.1 });
                summaries.push(`### ${section.title}\n${response.content}`);
            } catch {
                // Fallback: use first 300 chars of the section
                summaries.push(`### ${section.title}\n${section.content.slice(0, 300)}...`);
            }
        }

        return summaries.join('\n\n');
    }

    private async deduplicateReportSections(
        sections: { title: string; content: string }[],
        _query: string,
        _abortSignal?: AbortSignal
    ): Promise<void> {
        const skipLower = ['methodology', 'references'];

        // Global set of 4-grams seen so far across all processed sections
        const seenNgrams = new Set<string>();
        let isFirstContentSection = true;

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (section.content === '__EXEC_SUMMARY_PLACEHOLDER__') continue;
            if (skipLower.some(k => section.title.toLowerCase().includes(k))) continue;

            const paragraphs = section.content.split(/\n\n+/);
            const newParagraphs: string[] = [];

            for (const para of paragraphs) {
                // Skip markdown headers, horizontal rules
                if (para.trim().startsWith('#') || para.trim().startsWith('---')) {
                    newParagraphs.push(para);
                    continue;
                }

                // Strip "Forward-Looking Statement" blocks from all but last section
                if (para.trim().startsWith('Forward-Looking Statement') || para.trim().startsWith('**Forward-Looking Statement**')) {
                    if (i === sections.length - 1) {
                        newParagraphs.push(para);
                    }
                    continue;
                }

                // Strip generic closing paragraphs about "transparent and ethical practices"
                const paraLower = para.toLowerCase();
                if (paraLower.includes('transparent and ethical practices') ||
                    paraLower.includes('ethical decision-making, content integrity') ||
                    (paraLower.includes('broader concerns about') && paraLower.includes('gaming industry'))) {
                    // Only keep in the final section
                    if (i === sections.length - 1) {
                        newParagraphs.push(para);
                    }
                    continue;
                }

                const sentences = this.splitIntoSentences(para);
                const keptSentences: string[] = [];

                for (const sentence of sentences) {
                    const ngrams = this.extractNgrams(sentence, 4);

                    if (isFirstContentSection) {
                        // First content section establishes baseline — always keep
                        keptSentences.push(sentence);
                        for (const ng of ngrams) seenNgrams.add(ng);
                    } else {
                        // Count how many of this sentence's 4-grams already appeared
                        let matchCount = 0;
                        for (const ng of ngrams) {
                            if (seenNgrams.has(ng)) matchCount++;
                        }

                        // Dual threshold: need ≥3 matching 4-grams AND they must represent
                        // ≥30% of the sentence's total n-grams. This prevents over-aggressive
                        // dedup where long sentences with incidental topic overlap get killed.
                        const matchRatio = ngrams.length > 0 ? matchCount / ngrams.length : 0;
                        if (matchCount >= 3 && matchRatio >= 0.3) {
                            continue; // skip duplicate
                        }

                        keptSentences.push(sentence);
                        for (const ng of ngrams) seenNgrams.add(ng);
                    }
                }

                if (keptSentences.length > 0) {
                    newParagraphs.push(keptSentences.join(' '));
                }
            }

            if (isFirstContentSection) {
                isFirstContentSection = false;
            }

            const newContent = newParagraphs.join('\n\n').trim();
            if (newContent.length > 100) {
                sections[i] = { title: section.title, content: newContent };
            }
        }
    }

    /**
     * Extract normalized 4-grams (sequences of 4 consecutive words) from text.
     * Strips punctuation and lowercases for matching. Skips very short/stop-only grams.
     */
    private extractNgrams(text: string, n: number): string[] {
        // Normalize: lowercase, strip punctuation except hyphens within words
        const normalized = text.toLowerCase().replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
        const words = normalized.split(' ').filter(w => w.length > 0);
        const ngrams: string[] = [];

        if (words.length < n) return ngrams;

        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had',
            'this', 'that', 'these', 'those', 'it', 'its', 'as', 'not', 'no']);

        for (let i = 0; i <= words.length - n; i++) {
            const gram = words.slice(i, i + n);
            // Skip n-grams that are ALL stop words (too generic to be meaningful)
            const contentWords = gram.filter(w => !stopWords.has(w));
            if (contentWords.length >= 2) {
                ngrams.push(gram.join(' '));
            }
        }

        return ngrams;
    }

    /**
     * Split text into sentences, handling common abbreviations.
     */
    private splitIntoSentences(text: string): string[] {
        const sentences: string[] = [];
        const parts = text.split(/(?<=[.!?])\s+(?=[A-Z\["])/);
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.length > 10) {
                sentences.push(trimmed);
            }
        }
        return sentences;
    }
}

