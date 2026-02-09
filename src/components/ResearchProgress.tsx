import { Search, BookOpen, Brain, Check, Loader2, FileText } from 'lucide-react';
import type { ResearchStep } from '../services/researchOrchestrator';

interface ResearchProgressProps {
    steps: ResearchStep[];
    currentStep: ResearchStep | null;
    onCancel: () => void;
    startTime?: Date;
    intensity?: string;
}

const STEP_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
    clarifying: Brain,
    planning: Brain,
    searching: Search,
    reading: BookOpen,
    synthesizing: Brain,
    writing: FileText,
    complete: Check
};

const PHASE_LABELS: Record<string, string> = {
    clarifying: 'Clarifying',
    planning: 'Planning',
    searching: 'Searching',
    reading: 'Reading Sources',
    synthesizing: 'Synthesizing',
    writing: 'Writing Report',
    complete: 'Complete'
};

export function ResearchProgress({ steps, currentStep, onCancel, startTime, intensity }: ResearchProgressProps) {
    const elapsedSeconds = startTime
        ? Math.floor((Date.now() - startTime.getTime()) / 1000)
        : 0;

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Get progress info from current step
    const progress = currentStep?.progress;
    const progressPercent = progress
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    // Count sources read from steps
    const sourcesRead = steps.filter(s => s.type === 'reading').length;

    // Get last N steps for activity log
    const recentSteps = steps.slice(-8);

    return (
        <div className="research-progress enhanced">
            <div className="progress-header">
                <div className="header-left">
                    <Loader2 size={28} className="spin header-spinner" />
                    <div className="header-text">
                        <h2>Deep Research in Progress</h2>
                        {intensity && (
                            <span className="intensity-badge">{intensity}</span>
                        )}
                    </div>
                </div>
                <div className="header-right">
                    <div className="elapsed-time">
                        <span className="time-value">{formatTime(elapsedSeconds)}</span>
                        <span className="time-label">elapsed</span>
                    </div>
                    <button className="cancel-btn" onClick={onCancel}>
                        Cancel
                    </button>
                </div>
            </div>

            {/* Phase Progress */}
            <div className="phase-progress">
                <div className="phase-info">
                    <span className="phase-name">
                        {progress?.phase || PHASE_LABELS[currentStep?.type || 'planning']}
                    </span>
                    {progress && (
                        <span className="phase-count">
                            {progress.current} / {progress.total}
                        </span>
                    )}
                </div>
                <div className="progress-bar-container">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${progressPercent || 5}%` }}
                        />
                    </div>
                    <span className="progress-percent">{progressPercent}%</span>
                </div>
            </div>

            {/* Stats Row */}
            <div className="stats-row">
                <div className="stat">
                    <FileText size={18} />
                    <span className="stat-value">{sourcesRead}</span>
                    <span className="stat-label">sources read</span>
                </div>
                <div className="stat">
                    <Search size={18} />
                    <span className="stat-value">{steps.filter(s => s.type === 'searching').length}</span>
                    <span className="stat-label">searches</span>
                </div>
                <div className="stat">
                    <Brain size={18} />
                    <span className="stat-value">{steps.filter(s => s.type === 'synthesizing').length}</span>
                    <span className="stat-label">syntheses</span>
                </div>
            </div>

            {/* Current Activity */}
            <div className="current-activity">
                {currentStep && (
                    <div className="activity-message">
                        <Loader2 size={16} className="spin" />
                        <span>{currentStep.message}</span>
                    </div>
                )}
            </div>

            {/* Activity Log */}
            <div className="activity-log">
                <h4>Activity Log</h4>
                <div className="log-entries">
                    {recentSteps.map((step, index) => {
                        const Icon = STEP_ICONS[step.type] || Brain;
                        const isCurrent = step === currentStep;

                        return (
                            <div
                                key={index}
                                className={`log-entry ${isCurrent ? 'current' : ''}`}
                            >
                                <Icon size={14} />
                                <span className="log-message">{step.message}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
