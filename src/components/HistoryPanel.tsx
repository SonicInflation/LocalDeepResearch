import { X, Trash2, Clock, FileText, ChevronRight } from 'lucide-react';
import type { ResearchSession } from '../services/historyService';

interface HistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    sessions: ResearchSession[];
    onSelectSession: (session: ResearchSession) => void;
    onDeleteSession: (id: string) => void;
}

export function HistoryPanel({
    isOpen,
    onClose,
    sessions,
    onSelectSession,
    onDeleteSession
}: HistoryPanelProps) {
    if (!isOpen) return null;

    const formatDate = (date: Date) => {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const truncateQuery = (query: string, maxLength = 60) => {
        if (query.length <= maxLength) return query;
        return query.substring(0, maxLength) + '...';
    };

    return (
        <>
            <div className="history-overlay" onClick={onClose} />
            <div className="history-panel">
                <div className="history-header">
                    <h2>Research History</h2>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="history-content">
                    {sessions.length === 0 ? (
                        <div className="history-empty">
                            <FileText size={48} />
                            <p>No research history yet</p>
                            <span>Completed research sessions will appear here</span>
                        </div>
                    ) : (
                        <div className="history-list">
                            {sessions.map((session) => (
                                <div
                                    key={session.id}
                                    className="history-item"
                                    onClick={() => onSelectSession(session)}
                                >
                                    <div className="history-item-content">
                                        <div className="history-item-query">
                                            {truncateQuery(session.query)}
                                        </div>
                                        <div className="history-item-meta">
                                            <span className="history-item-date">
                                                <Clock size={14} />
                                                {formatDate(session.createdAt)}
                                            </span>
                                            <span className="history-item-sources">
                                                <FileText size={14} />
                                                {session.report.metadata.totalSources} sources
                                            </span>
                                        </div>
                                    </div>
                                    <div className="history-item-actions">
                                        <button
                                            className="delete-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteSession(session.id);
                                            }}
                                            title="Delete"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <ChevronRight size={20} className="chevron" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
