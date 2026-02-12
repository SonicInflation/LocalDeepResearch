import { useState, useCallback, useRef, useEffect } from 'react';
import { Settings, History } from 'lucide-react';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ResearchInput } from './components/ResearchInput';
import { ResearchProgress } from './components/ResearchProgress';
import { ResearchReportView } from './components/ResearchReportView';
import { ClarifyingQuestions } from './components/ClarifyingQuestions';
import type { AppSettings } from './config/settings';
import { loadSettings } from './config/settings';
import { AIService } from './services/aiService';
import { SearchService } from './services/searchService';
import { historyService } from './services/historyService';
import type { ResearchSession } from './services/historyService';
import type { ResearchStep, ResearchReport, ClarifyingQuestion } from './services/researchOrchestrator';
import { ResearchOrchestrator } from './services/researchOrchestrator';
import './App.css';

type AppState = 'idle' | 'clarifying' | 'researching' | 'complete';

function App() {
  const [state, setState] = useState<AppState>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [steps, setSteps] = useState<ResearchStep[]>([]);
  const [currentStep, setCurrentStep] = useState<ResearchStep | null>(null);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researchStartTime, setResearchStartTime] = useState<Date | null>(null);

  // Clarifying questions state
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const [clarifyingQuestions, setClarifyingQuestions] = useState<ClarifyingQuestion[]>([]);

  // History state
  const [sessions, setSessions] = useState<ResearchSession[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const orchestratorRef = useRef<ResearchOrchestrator | null>(null);

  // Load history on mount
  useEffect(() => {
    historyService.getSessions().then(setSessions).catch(console.error);
  }, []);

  const handleSettingsChange = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
  }, []);

  const initializeOrchestrator = useCallback(() => {
    const aiService = new AIService(settings.aiProvider);
    const searchService = new SearchService(settings.search);
    const orchestrator = new ResearchOrchestrator(
      aiService,
      searchService,
      settings.research,
      settings.aiProvider.model,
      settings.search.searxngUrl
    );
    orchestratorRef.current = orchestrator;
    return orchestrator;
  }, [settings]);

  const handleStartResearch = useCallback(async (query: string) => {
    setCurrentQuery(query);
    setError(null);

    const orchestrator = initializeOrchestrator();

    // Check if clarifying questions are enabled
    if (settings.research.enableClarifyingQuestions) {
      setState('clarifying');
      try {
        const questions = await orchestrator.generateClarifyingQuestions(query);
        if (questions.length > 0) {
          setClarifyingQuestions(questions);
          return; // Wait for user to answer questions
        }
      } catch (err) {
        console.error('Failed to generate clarifying questions:', err);
        // Continue without questions if generation fails
      }
    }

    // If no clarifying questions, start research directly
    await startResearchExecution(query, new Map());
  }, [settings, initializeOrchestrator]);

  const startResearchExecution = useCallback(async (
    query: string,
    answers: Map<string, string>
  ) => {
    setState('researching');
    setSteps([]);
    setCurrentStep(null);
    setReport(null);
    setResearchStartTime(new Date());

    abortControllerRef.current = new AbortController();

    const orchestrator = orchestratorRef.current || initializeOrchestrator();

    // Local accumulator to avoid closure issues
    const accumulatedSteps: ResearchStep[] = [];

    const handleProgress = (step: ResearchStep) => {
      accumulatedSteps.push(step);
      setCurrentStep(step);
      setSteps(prev => [...prev, step]);
    };

    try {
      const result = await orchestrator.research(
        query,
        handleProgress,
        abortControllerRef.current.signal,
        answers.size > 0 ? answers : undefined
      );
      setReport(result);
      setState('complete');

      // Save to history using the local accumulator
      console.log('[History] Saving session with', accumulatedSteps.length, 'steps');
      const activityLog = accumulatedSteps.map(s => s.message);
      try {
        await historyService.saveSession({
          query,
          report: result,
          activityLog
        });
        console.log('[History] Session saved successfully');
        // Refresh history list
        const updatedSessions = await historyService.getSessions();
        console.log('[History] Loaded', updatedSessions.length, 'sessions from IndexedDB');
        setSessions(updatedSessions);
      } catch (saveErr) {
        console.error('[History] Failed to save session:', saveErr);
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Research cancelled') {
        setState('idle');
      } else {
        setError(err instanceof Error ? err.message : 'Research failed');
        setState('idle');
      }
    }
  }, [initializeOrchestrator]);

  const handleClarifyingComplete = useCallback((answers: Map<string, string>) => {
    startResearchExecution(currentQuery, answers);
  }, [currentQuery, startResearchExecution]);

  const handleClarifyingSkip = useCallback(() => {
    startResearchExecution(currentQuery, new Map());
  }, [currentQuery, startResearchExecution]);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setState('idle');
  }, []);

  const handleNewResearch = useCallback(() => {
    setState('idle');
    setSteps([]);
    setCurrentStep(null);
    setReport(null);
    setError(null);
    setClarifyingQuestions([]);
    setCurrentQuery('');
    setResearchStartTime(null);
  }, []);

  const handleSelectSession = useCallback((session: ResearchSession) => {
    setReport(session.report);
    setCurrentQuery(session.query);
    setSteps(session.activityLog.map((msg, i) => ({
      type: 'complete' as const,
      message: msg,
      progress: { current: i + 1, total: session.activityLog.length, phase: 'History' }
    })));
    setState('complete');
    setHistoryOpen(false);
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    await historyService.deleteSession(id);
    const updatedSessions = await historyService.getSessions();
    setSessions(updatedSessions);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-title">
          <span className="logo">🔬</span>
          Local Deep Research
        </div>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={() => setHistoryOpen(true)}
            title="History"
          >
            <History size={20} />
          </button>
          <button
            className="header-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-banner">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {state === 'idle' && (
          <ResearchInput
            onStartResearch={handleStartResearch}
            isResearching={false}
          />
        )}

        {state === 'clarifying' && (
          <ClarifyingQuestions
            query={currentQuery}
            questions={clarifyingQuestions}
            onComplete={handleClarifyingComplete}
            onSkip={handleClarifyingSkip}
          />
        )}

        {state === 'researching' && (
          <ResearchProgress
            steps={steps}
            currentStep={currentStep}
            onCancel={handleCancel}
            startTime={researchStartTime || undefined}
            intensity={settings.research.intensity}
          />
        )}

        {state === 'complete' && report && (
          <ResearchReportView
            report={report}
            onNewResearch={handleNewResearch}
          />
        )}
      </main>

      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={handleSettingsChange}
      />

      <HistoryPanel
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />
    </div>
  );
}

export default App;
