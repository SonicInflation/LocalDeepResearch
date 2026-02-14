import { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import {
    FileText,
    ExternalLink,
    Copy,
    Check,
    ChevronDown,
    ChevronUp,
    Clock,
    ArrowLeft,
    Download,
    Loader2
} from 'lucide-react';
import type { ResearchReport, ResearchSource } from '../services/researchOrchestrator';
import { exportReportAsPdf } from '../services/pdfExport';

interface ResearchReportViewProps {
    report: ResearchReport;
    onNewResearch: () => void;
}

/**
 * Transform inline citation patterns like [1], [2], [3] in markdown content
 * into clickable HTML links that open the corresponding source URL in a new window.
 * Handles single citations [1], comma-separated [1, 2, 3], and ranges [1-3].
 */
function linkifyCitations(content: string, sources: ResearchSource[]): string {
    // Match patterns like [1], [2, 3], [1-3], [1, 2, 5-7], etc.
    // Avoid matching markdown links like [text](url) or images ![alt](url)
    return content.replace(
        /(?<!!)\[(\d[\d,\s\-]*)\](?!\()/g,
        (match, inner: string) => {
            // Parse the inner content to get individual citation numbers
            const parts = inner.split(',').map((p: string) => p.trim());
            const linkedParts: string[] = [];

            for (const part of parts) {
                const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
                if (rangeMatch) {
                    // Handle range like 1-3
                    const start = parseInt(rangeMatch[1]);
                    const end = parseInt(rangeMatch[2]);
                    for (let n = start; n <= end; n++) {
                        const source = sources[n - 1];
                        if (source?.url) {
                            linkedParts.push(
                                `<a href="${source.url}" target="_blank" rel="noopener noreferrer" class="citation-link" title="${source.title.replace(/"/g, '&quot;')}">${n}</a>`
                            );
                        } else {
                            linkedParts.push(`${n}`);
                        }
                    }
                } else {
                    const n = parseInt(part);
                    if (!isNaN(n)) {
                        const source = sources[n - 1];
                        if (source?.url) {
                            linkedParts.push(
                                `<a href="${source.url}" target="_blank" rel="noopener noreferrer" class="citation-link" title="${source.title.replace(/"/g, '&quot;')}">${n}</a>`
                            );
                        } else {
                            linkedParts.push(`${n}`);
                        }
                    } else {
                        // Not a number — return the original match unchanged
                        return match;
                    }
                }
            }

            if (linkedParts.length === 0) return match;

            return `<sup class="citation-group">[${linkedParts.join(', ')}]</sup>`;
        }
    );
}

export function ResearchReportView({ report, onNewResearch }: ResearchReportViewProps) {
    const [copiedSection, setCopiedSection] = useState<string | null>(null);
    const [expandedSources, setExpandedSources] = useState(false);
    const [pdfStatus, setPdfStatus] = useState<string | null>(null);
    const [pdfExporting, setPdfExporting] = useState(false);

    // Memoize citation-linked content for each section
    const linkedSections = useMemo(() =>
        report.sections.map(section => ({
            ...section,
            linkedContent: linkifyCitations(section.content, report.sources)
        })),
        [report.sections, report.sources]
    );

    const handleCopy = async (content: string, sectionId: string) => {
        await navigator.clipboard.writeText(content);
        setCopiedSection(sectionId);
        setTimeout(() => setCopiedSection(null), 3000);
    };

    const handleCopyAll = async () => {
        const fullContent = report.sections
            .map(s => `## ${s.title}\n\n${s.content}`)
            .join('\n\n---\n\n');

        const sources = report.sources
            .map((s, i) => `[${i + 1}] ${s.title}: ${s.url}`)
            .join('\n');

        await navigator.clipboard.writeText(`# ${report.query}\n\n${fullContent}\n\n---\n\n## Sources\n\n${sources}`);
        setCopiedSection('all');
        setTimeout(() => setCopiedSection(null), 3000);
    };

    const handleExportMd = () => {
        const fullContent = report.sections
            .map(s => `## ${s.title}\n\n${s.content}`)
            .join('\n\n---\n\n');

        const sources = report.sources
            .map((s, i) => `[${i + 1}] ${s.title}: ${s.url}`)
            .join('\n');

        const markdown = `# ${report.query}\n\n${fullContent}\n\n---\n\n## Sources\n\n${sources}`;

        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `research-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportPdf = useCallback(async () => {
        if (pdfExporting) return;
        setPdfExporting(true);
        setPdfStatus('Preparing...');
        try {
            await exportReportAsPdf(report, (status) => setPdfStatus(status));
            setPdfStatus('Saved!');
            setTimeout(() => setPdfStatus(null), 2500);
        } catch (err) {
            console.error('PDF export failed:', err);
            setPdfStatus('Export failed');
            setTimeout(() => setPdfStatus(null), 3000);
        } finally {
            setPdfExporting(false);
        }
    }, [report, pdfExporting]);

    return (
        <div className="research-report">
            <div className="report-header">
                <button className="back-btn" onClick={onNewResearch} aria-label="Start new research">
                    <ArrowLeft size={18} />
                    New Research
                </button>
                <div className="report-actions">
                    <button
                        className="action-btn"
                        onClick={handleCopyAll}
                    >
                        {copiedSection === 'all' ? <Check size={16} /> : <Copy size={16} />}
                        {copiedSection === 'all' ? 'Copied!' : 'Copy All'}
                    </button>
                    <button
                        className="action-btn"
                        onClick={handleExportPdf}
                        disabled={pdfExporting}
                    >
                        {pdfExporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                        {pdfStatus || 'Export PDF'}
                    </button>
                    <button
                        className="action-btn"
                        onClick={handleExportMd}
                    >
                        <FileText size={16} />
                        Export MD
                    </button>
                </div>
            </div>

            <div className="report-meta">
                <h1>{report.query}</h1>
                <div className="meta-info">
                    <span>
                        <Clock size={14} />
                        {report.generatedAt.toLocaleString()}
                    </span>
                    {report.metadata?.researchDuration != null && (
                        <span>
                            <Clock size={14} />
                            {report.metadata.researchDuration >= 60
                                ? `${Math.floor(report.metadata.researchDuration / 60)}m ${report.metadata.researchDuration % 60}s`
                                : `${report.metadata.researchDuration}s`
                            }
                        </span>
                    )}
                    <span>
                        <FileText size={14} />
                        {report.sources.length} sources
                    </span>
                </div>
            </div>

            <div className="report-content">
                {linkedSections.map((section, index) => (
                    <div key={index} className="report-section">
                        <div className="section-header">
                            <h2>{section.title}</h2>
                            <button
                                className="copy-btn"
                                onClick={() => handleCopy(section.content, `section-${index}`)}
                                title="Copy section"
                                aria-label={`Copy ${section.title}`}
                            >
                                {copiedSection === `section-${index}` ? (
                                    <Check size={14} />
                                ) : (
                                    <Copy size={14} />
                                )}
                            </button>
                        </div>
                        <div className="section-content">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                            >
                                {section.linkedContent}
                            </ReactMarkdown>
                        </div>
                    </div>
                ))}
            </div>

            <div className="report-sources">
                <button
                    className="sources-toggle"
                    onClick={() => setExpandedSources(!expandedSources)}
                >
                    <h3>
                        Sources ({report.sources.length})
                    </h3>
                    {expandedSources ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>

                {expandedSources && (
                    <div className="sources-list">
                        {report.sources.map((source, index) => (
                            <div key={index} className="source-item">
                                <span className="source-number">[{index + 1}]</span>
                                <div className="source-info">
                                    <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="source-title"
                                    >
                                        {source.title}
                                        <ExternalLink size={12} />
                                    </a>
                                    <p className="source-snippet">{source.snippet}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
