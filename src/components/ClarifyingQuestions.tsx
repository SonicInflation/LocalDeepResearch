import { useState, useRef, useEffect } from 'react';
import { Brain, SkipForward, ArrowRight, Pencil } from 'lucide-react';
import type { ClarifyingQuestion } from '../services/researchOrchestrator';

interface ClarifyingQuestionsProps {
    query: string;
    questions: ClarifyingQuestion[];
    onComplete: (answers: Map<string, string>) => void;
    onSkip: () => void;
}

export function ClarifyingQuestions({
    query,
    questions,
    onComplete,
    onSkip
}: ClarifyingQuestionsProps) {
    const [answers, setAnswers] = useState<Map<string, string>>(new Map());
    const [currentIndex, setCurrentIndex] = useState(0);
    const [showCustomInput, setShowCustomInput] = useState(false);
    const customInputRef = useRef<HTMLInputElement>(null);

    const currentQuestion = questions[currentIndex];

    // Focus custom input when it appears
    useEffect(() => {
        if (showCustomInput && customInputRef.current) {
            customInputRef.current.focus();
        }
    }, [showCustomInput]);

    // Reset custom input when moving to next question
    useEffect(() => {
        setShowCustomInput(false);
    }, [currentIndex]);
    const isLastQuestion = currentIndex >= questions.length - 1;

    const handleAnswer = (answer: string) => {
        const newAnswers = new Map(answers);
        newAnswers.set(currentQuestion.id, answer);
        setAnswers(newAnswers);

        if (isLastQuestion) {
            onComplete(newAnswers);
        } else {
            setCurrentIndex(currentIndex + 1);
        }
    };

    const handleCustomSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem('customAnswer') as HTMLInputElement;
        if (input.value.trim()) {
            handleAnswer(input.value.trim());
        }
    };

    const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem('answer') as HTMLInputElement;
        if (input.value.trim()) {
            handleAnswer(input.value.trim());
        }
    };

    if (!currentQuestion) {
        return null;
    }

    return (
        <div className="clarifying-questions">
            <div className="clarifying-header">
                <Brain size={32} className="clarifying-icon" />
                <div className="clarifying-title">
                    <h2>Quick Questions</h2>
                    <p>Help me understand your research needs better</p>
                </div>
            </div>

            <div className="query-preview">
                <span className="query-label">Research Topic:</span>
                <span className="query-text">{query}</span>
            </div>

            <div className="question-progress">
                <div className="progress-dots">
                    {questions.map((_, idx) => (
                        <div
                            key={idx}
                            className={`progress-dot ${idx < currentIndex ? 'answered' : ''} ${idx === currentIndex ? 'current' : ''}`}
                        />
                    ))}
                </div>
                <span className="progress-text">
                    Question {currentIndex + 1} of {questions.length}
                </span>
            </div>

            <div className="question-card">
                <p className="question-text">{currentQuestion.question}</p>

                {currentQuestion.type === 'text' && (
                    <form onSubmit={handleTextSubmit} className="text-answer">
                        <input
                            type="text"
                            name="answer"
                            placeholder="Type your answer..."
                            autoFocus
                        />
                        <button type="submit" className="submit-btn">
                            {isLastQuestion ? 'Start Research' : 'Next'}
                            <ArrowRight size={16} />
                        </button>
                    </form>
                )}

                {currentQuestion.type === 'choice' && currentQuestion.options && (
                    <div className="choice-options">
                        {currentQuestion.options.map((option, idx) => (
                            <button
                                key={idx}
                                className="choice-btn"
                                onClick={() => handleAnswer(option)}
                            >
                                {option}
                            </button>
                        ))}
                        {!showCustomInput ? (
                            <button
                                className="custom-answer-toggle"
                                onClick={() => setShowCustomInput(true)}
                            >
                                <Pencil size={14} />
                                Write my own answer
                            </button>
                        ) : (
                            <form onSubmit={handleCustomSubmit} className="custom-answer-form">
                                <input
                                    ref={customInputRef}
                                    type="text"
                                    name="customAnswer"
                                    placeholder="Type your own answer..."
                                />
                                <button type="submit" className="submit-btn">
                                    {isLastQuestion ? 'Start Research' : 'Next'}
                                    <ArrowRight size={16} />
                                </button>
                            </form>
                        )}
                    </div>
                )}

                {currentQuestion.type === 'confirm' && (
                    <div className="confirm-options-wrapper">
                        <div className="confirm-options">
                            <button
                                className="confirm-btn yes"
                                onClick={() => handleAnswer('Yes')}
                            >
                                Yes
                            </button>
                            <button
                                className="confirm-btn no"
                                onClick={() => handleAnswer('No')}
                            >
                                No
                            </button>
                        </div>
                        {!showCustomInput ? (
                            <button
                                className="custom-answer-toggle"
                                onClick={() => setShowCustomInput(true)}
                            >
                                <Pencil size={14} />
                                Write my own answer
                            </button>
                        ) : (
                            <form onSubmit={handleCustomSubmit} className="custom-answer-form">
                                <input
                                    ref={customInputRef}
                                    type="text"
                                    name="customAnswer"
                                    placeholder="Type your own answer..."
                                />
                                <button type="submit" className="submit-btn">
                                    {isLastQuestion ? 'Start Research' : 'Next'}
                                    <ArrowRight size={16} />
                                </button>
                            </form>
                        )}
                    </div>
                )}
            </div>

            <button className="skip-btn" onClick={onSkip}>
                <SkipForward size={16} />
                Skip questions and start research
            </button>
        </div>
    );
}
