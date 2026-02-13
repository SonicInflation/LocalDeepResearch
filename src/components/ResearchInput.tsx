import { useState, useEffect } from 'react';
import { Search, Sparkles, TrendingUp } from 'lucide-react';
import { getTrendingTopics } from '../services/trendingTopicsService';

interface ResearchInputProps {
    onStartResearch: (query: string) => void;
    isResearching: boolean;
    searxngUrl: string;
}

const FALLBACK_QUERIES = [
    "What are the latest developments in quantum computing?",
    "Compare the pros and cons of Rust vs Go for backend development",
    "How does mRNA vaccine technology work?",
    "What are the environmental impacts of electric vehicles?",
    "Explain the current state of nuclear fusion research"
];

export function ResearchInput({ onStartResearch, isResearching, searxngUrl }: ResearchInputProps) {
    const [query, setQuery] = useState('');
    const [displayedExamples, setDisplayedExamples] = useState<string[]>(FALLBACK_QUERIES);
    const [isTrending, setIsTrending] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getTrendingTopics(searxngUrl).then(result => {
            if (!cancelled) {
                setDisplayedExamples(result.topics);
                setIsTrending(result.isTrending);
            }
        });
        return () => { cancelled = true; };
    }, [searxngUrl]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim() && !isResearching) {
            onStartResearch(query.trim());
        }
    };

    const handleExampleClick = (example: string) => {
        setQuery(example);
    };

    return (
        <div className="research-input-container">
            <div className="hero-section">
                <div className="hero-icon">
                    <Sparkles size={48} />
                </div>
                <h1>Local Deep Research</h1>
                <p className="hero-subtitle">
                    AI-powered research using local models and SearXNG
                </p>
            </div>

            <form onSubmit={handleSubmit} className="research-form">
                <div className="input-wrapper">
                    <Search size={20} className="input-icon" />
                    <textarea
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="What would you like to research?"
                        disabled={isResearching}
                        rows={3}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e);
                            }
                        }}
                    />
                </div>
                <button
                    type="submit"
                    className="research-btn"
                    disabled={!query.trim() || isResearching}
                >
                    {isResearching ? (
                        <>
                            <span className="spinner"></span>
                            Researching...
                        </>
                    ) : (
                        <>
                            <Sparkles size={18} />
                            Start Research
                        </>
                    )}
                </button>
            </form>

            <div className="examples-section">
                <p className="examples-label">
                    {isTrending ? (
                        <><TrendingUp size={14} /> Trending topics:</>
                    ) : (
                        'Try an example:'
                    )}
                </p>
                <div className="examples-list">
                    {displayedExamples.map((example, i) => (
                        <button
                            key={`${isTrending}-${i}`}
                            className="example-btn"
                            onClick={() => handleExampleClick(example)}
                            disabled={isResearching}
                        >
                            {example}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
