import { useState, useEffect } from 'react';
import { Settings, CheckCircle, XCircle, Loader2, ChevronDown, Clock, FileText } from 'lucide-react';
import type { AppSettings, AIProviderType, ResearchIntensity } from '../config/settings';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, INTENSITY_CONFIGS } from '../config/settings';
import type { ModelInfo } from '../services/aiService';
import { AIService } from '../services/aiService';
import { SearchService } from '../services/searchService';

interface SettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSettingsChange: (settings: AppSettings) => void;
}

const INTENSITY_LABELS: Record<ResearchIntensity, { label: string; description: string }> = {
    quick: { label: '⚡ Quick', description: '~10 sources, 2-5 min' },
    standard: { label: '📊 Standard', description: '~25 sources, 5-15 min' },
    deep: { label: '🔍 Deep', description: '~50 sources, 15-25 min' },
    comprehensive: { label: '📚 Comprehensive', description: '~100 sources, 30-50 min' },
    exhaustive: { label: '🏛️ Exhaustive', description: '~200 sources, 45-90 min' }
};

export function SettingsPanel({ isOpen, onClose, onSettingsChange }: SettingsPanelProps) {
    const [settings, setSettings] = useState<AppSettings>(loadSettings);
    const [aiStatus, setAiStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [aiMessage, setAiMessage] = useState('');
    const [searchStatus, setSearchStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [searchMessage, setSearchMessage] = useState('');
    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);

    useEffect(() => {
        if (isOpen) {
            setSettings(loadSettings());
        }
    }, [isOpen]);

    const updateAIProvider = (updates: Partial<AppSettings['aiProvider']>) => {
        setSettings(prev => ({
            ...prev,
            aiProvider: { ...prev.aiProvider, ...updates }
        }));
        setAiStatus('idle');
        setAvailableModels([]);
    };

    const updateSearch = (updates: Partial<AppSettings['search']>) => {
        setSettings(prev => ({
            ...prev,
            search: { ...prev.search, ...updates }
        }));
        setSearchStatus('idle');
    };

    const updateResearch = (updates: Partial<AppSettings['research']>) => {
        setSettings(prev => ({
            ...prev,
            research: { ...prev.research, ...updates }
        }));
    };

    const testAIConnection = async () => {
        setAiStatus('testing');
        setAiMessage('Testing connection...');

        const aiService = new AIService(settings.aiProvider);
        const result = await aiService.testConnection();

        if (result.success) {
            setAiStatus('success');
            setAiMessage(result.message);
            if (result.models) {
                setAvailableModels(result.models);
            }
        } else {
            setAiStatus('error');
            setAiMessage(result.message);
        }
    };

    const testSearchConnection = async () => {
        setSearchStatus('testing');
        setSearchMessage('Testing connection...');

        const searchService = new SearchService(settings.search);
        const result = await searchService.testConnection();

        if (result.success) {
            setSearchStatus('success');
            setSearchMessage(result.message);
        } else {
            setSearchStatus('error');
            setSearchMessage(result.message);
        }
    };

    const handleSave = () => {
        saveSettings(settings);
        onSettingsChange(settings);
        onClose();
    };

    const handleReset = () => {
        setSettings(DEFAULT_SETTINGS);
        setAiStatus('idle');
        setSearchStatus('idle');
        setAvailableModels([]);
    };

    const currentIntensity = INTENSITY_CONFIGS[settings.research.intensity];

    if (!isOpen) return null;

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-panel" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                    <Settings size={24} />
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="settings-content">
                    {/* AI Provider Section */}
                    <section className="settings-section">
                        <h3>AI Provider</h3>

                        <div className="form-group">
                            <label>Provider Type</label>
                            <select
                                value={settings.aiProvider.type}
                                onChange={e => updateAIProvider({ type: e.target.value as AIProviderType })}
                            >
                                <option value="ollama">Ollama</option>
                                <option value="lmstudio">LM Studio</option>
                                <option value="openai-compatible">OpenAI Compatible</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Endpoint URL</label>
                            <input
                                type="text"
                                value={settings.aiProvider.endpoint}
                                onChange={e => updateAIProvider({ endpoint: e.target.value })}
                                placeholder={settings.aiProvider.type === 'ollama'
                                    ? 'http://localhost:11434'
                                    : 'http://localhost:1234/v1'}
                            />
                        </div>

                        <div className="form-group">
                            <label>Model</label>
                            {availableModels.length > 0 ? (
                                <div className="select-wrapper">
                                    <select
                                        value={settings.aiProvider.model}
                                        onChange={e => updateAIProvider({ model: e.target.value })}
                                    >
                                        {availableModels.map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="select-icon" />
                                </div>
                            ) : (
                                <input
                                    type="text"
                                    value={settings.aiProvider.model}
                                    onChange={e => updateAIProvider({ model: e.target.value })}
                                    placeholder="e.g., llama3.2, mistral"
                                />
                            )}
                        </div>

                        {settings.aiProvider.type === 'openai-compatible' && (
                            <div className="form-group">
                                <label>API Key (optional)</label>
                                <input
                                    type="password"
                                    value={settings.aiProvider.apiKey || ''}
                                    onChange={e => updateAIProvider({ apiKey: e.target.value })}
                                    placeholder="sk-..."
                                />
                            </div>
                        )}

                        <div className="connection-test">
                            <button
                                className="test-btn"
                                onClick={testAIConnection}
                                disabled={aiStatus === 'testing'}
                            >
                                {aiStatus === 'testing' ? (
                                    <><Loader2 size={16} className="spin" /> Testing...</>
                                ) : (
                                    'Test Connection'
                                )}
                            </button>
                            {aiStatus !== 'idle' && aiStatus !== 'testing' && (
                                <span className={`status ${aiStatus}`}>
                                    {aiStatus === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                                    {aiMessage}
                                </span>
                            )}
                        </div>
                    </section>

                    {/* Search Section */}
                    <section className="settings-section">
                        <h3>Search (SearXNG)</h3>

                        <div className="form-group">
                            <label>SearXNG URL</label>
                            <input
                                type="text"
                                value={settings.search.searxngUrl}
                                onChange={e => updateSearch({ searxngUrl: e.target.value })}
                                placeholder="http://localhost:8080"
                            />
                        </div>

                        <div className="form-group">
                            <label>Max Results per Search</label>
                            <input
                                type="number"
                                min={5}
                                max={30}
                                value={settings.search.maxResults}
                                onChange={e => updateSearch({ maxResults: parseInt(e.target.value) || 10 })}
                            />
                        </div>

                        <div className="connection-test">
                            <button
                                className="test-btn"
                                onClick={testSearchConnection}
                                disabled={searchStatus === 'testing'}
                            >
                                {searchStatus === 'testing' ? (
                                    <><Loader2 size={16} className="spin" /> Testing...</>
                                ) : (
                                    'Test Connection'
                                )}
                            </button>
                            {searchStatus !== 'idle' && searchStatus !== 'testing' && (
                                <span className={`status ${searchStatus}`}>
                                    {searchStatus === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                                    {searchMessage}
                                </span>
                            )}
                        </div>
                    </section>

                    {/* Research Settings */}
                    <section className="settings-section">
                        <h3>Research Settings</h3>

                        <div className="form-group">
                            <label>Research Intensity</label>
                            <select
                                value={settings.research.intensity}
                                onChange={e => updateResearch({
                                    intensity: e.target.value as ResearchIntensity
                                })}
                            >
                                {Object.entries(INTENSITY_LABELS).map(([key, { label, description }]) => (
                                    <option key={key} value={key}>
                                        {label} - {description}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="intensity-preview">
                            <div className="intensity-stat">
                                <FileText size={16} />
                                <span>Up to {currentIntensity.maxSources} sources</span>
                            </div>
                            <div className="intensity-stat">
                                <Clock size={16} />
                                <span>{currentIntensity.estimatedMinutes[0]}-{currentIntensity.estimatedMinutes[1]} minutes</span>
                            </div>
                        </div>

                        <div className="form-group checkbox-group">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={settings.research.enableClarifyingQuestions}
                                    onChange={e => updateResearch({
                                        enableClarifyingQuestions: e.target.checked
                                    })}
                                />
                                <span>Ask clarifying questions before research</span>
                            </label>
                        </div>

                        <div className="form-group checkbox-group">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={settings.research.enableStreaming}
                                    onChange={e => updateResearch({
                                        enableStreaming: e.target.checked
                                    })}
                                />
                                <span>Stream report as it's written</span>
                            </label>
                        </div>

                        <div className="form-group checkbox-group">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={settings.research.enableAdaptiveResearch}
                                    onChange={e => updateResearch({
                                        enableAdaptiveResearch: e.target.checked
                                    })}
                                />
                                <span>Adaptive research (iteratively find and fill knowledge gaps)</span>
                            </label>
                        </div>

                        {settings.research.enableAdaptiveResearch && (
                            <div className="form-group">
                                <label>Max Research Iterations: {settings.research.maxResearchIterations}</label>
                                <input
                                    type="range"
                                    min={1}
                                    max={5}
                                    value={settings.research.maxResearchIterations ?? 3}
                                    onChange={e => updateResearch({
                                        maxResearchIterations: parseInt(e.target.value)
                                    })}
                                />
                                <div className="range-labels">
                                    <span>1 (faster)</span>
                                    <span>5 (deeper)</span>
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                <div className="settings-footer">
                    <button className="btn-secondary" onClick={handleReset}>
                        Reset to Defaults
                    </button>
                    <button className="btn-primary" onClick={handleSave}>
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
}
