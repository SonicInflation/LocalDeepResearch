import { useState, useEffect, useRef } from 'react';
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
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Escape key to close
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (pendingDeleteId) {
                    setPendingDeleteId(null);
                } else {
                    onClose();
                }
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose, pendingDeleteId]);

    // Focus trap
    useEffect(() => {
        if (!isOpen || !panelRef.current) return;
        const panel = panelRef.current;
        const focusable = panel.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        first.focus();

        const trap = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        };
        panel.addEventListener('keydown', trap);
        return () => panel.removeEventListener('keydown', trap);
    }, [isOpen, sessions, pendingDeleteId]);

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
            <div
                className="history-panel"
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Research history"
            >
                <div className="history-header">
                    <h2>Research History</h2>
                    <button className="close-btn" onClick={onClose} aria-label="Close history">
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
                                        <div className="history-item-query" title={session.query}>
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
                                        {pendingDeleteId === session.id ? (
                                            <div className="delete-confirm" onClick={e => e.stopPropagation()}>
                                                <span className="delete-confirm-text">Delete?</span>
                                                <button
                                                    className="delete-confirm-yes"
                                                    onClick={() => {
                                                        onDeleteSession(session.id);
                                                        setPendingDeleteId(null);
                                                    }}
                                                >
                                                    Yes
                                                </button>
                                                <button
                                                    className="delete-confirm-no"
                                                    onClick={() => setPendingDeleteId(null)}
                                                >
                                                    No
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    className="delete-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPendingDeleteId(session.id);
                                                    }}
                                                    aria-label={`Delete research: ${truncateQuery(session.query, 30)}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                                <ChevronRight size={20} className="chevron" />
                                            </>
                                        )}
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
