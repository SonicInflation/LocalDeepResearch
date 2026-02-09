import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    FileText,
    ExternalLink,
    Copy,
    Check,
    ChevronDown,
    ChevronUp,
    Clock,
    ArrowLeft
} from 'lucide-react';
import type { ResearchReport } from '../services/researchOrchestrator';

interface ResearchReportViewProps {
    report: ResearchReport;
    onNewResearch: () => void;
}

export function ResearchReportView({ report, onNewResearch }: ResearchReportViewProps) {
    const [copiedSection, setCopiedSection] = useState<string | null>(null);
    const [expandedSources, setExpandedSources] = useState(false);

    const handleCopy = async (content: string, sectionId: string) => {
        await navigator.clipboard.writeText(content);
        setCopiedSection(sectionId);
        setTimeout(() => setCopiedSection(null), 2000);
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
        setTimeout(() => setCopiedSection(null), 2000);
    };

    const handleExport = () => {
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

    return (
        <div className="research-report">
            <div className="report-header">
                <button className="back-btn" onClick={onNewResearch}>
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
                        onClick={handleExport}
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
                    <span>
                        <FileText size={14} />
                        {report.sources.length} sources
                    </span>
                </div>
            </div>

            <div className="report-content">
                {report.sections.map((section, index) => (
                    <div key={index} className="report-section">
                        <div className="section-header">
                            <h2>{section.title}</h2>
                            <button
                                className="copy-btn"
                                onClick={() => handleCopy(section.content, `section-${index}`)}
                                title="Copy section"
                            >
                                {copiedSection === `section-${index}` ? (
                                    <Check size={14} />
                                ) : (
                                    <Copy size={14} />
                                )}
                            </button>
                        </div>
                        <div className="section-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {section.content}
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
