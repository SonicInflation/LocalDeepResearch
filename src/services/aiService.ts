// AI Service - Handles communication with LM Studio, Ollama, and OpenAI-compatible endpoints

import type { AIProviderConfig } from '../config/settings';
import { getEndpointForProvider } from '../config/settings';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatCompletionResponse {
    content: string;
    finishReason?: string;
}

export interface ModelInfo {
    id: string;
    name: string;
}

export class AIService {
    private config: AIProviderConfig;

    constructor(config: AIProviderConfig) {
        this.config = config;
    }

    updateConfig(config: AIProviderConfig): void {
        this.config = config;
    }

    async chat(
        messages: ChatMessage[],
        onStream?: (chunk: string) => void
    ): Promise<ChatCompletionResponse> {
        const endpoint = getEndpointForProvider(this.config);

        if (this.config.type === 'ollama') {
            return this.chatOllama(endpoint, messages, onStream);
        } else {
            return this.chatOpenAICompatible(endpoint, messages, onStream);
        }
    }

    private async chatOpenAICompatible(
        baseUrl: string,
        messages: ChatMessage[],
        onStream?: (chunk: string) => void
    ): Promise<ChatCompletionResponse> {
        const url = `${baseUrl}/chat/completions`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.config.model,
                messages,
                stream: !!onStream
            })
        });

        if (!response.ok) {
            throw new Error(`AI request failed: ${response.status} ${response.statusText}`);
        }

        if (onStream && response.body) {
            return this.handleOpenAIStream(response.body, onStream);
        }

        const data = await response.json();
        return {
            content: data.choices[0]?.message?.content || '',
            finishReason: data.choices[0]?.finish_reason
        };
    }

    private async handleOpenAIStream(
        body: ReadableStream<Uint8Array>,
        onStream: (chunk: string) => void
    ): Promise<ChatCompletionResponse> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));

                for (const line of lines) {
                    const jsonStr = line.replace('data:', '').trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const data = JSON.parse(jsonStr);
                        const content = data.choices[0]?.delta?.content || '';
                        if (content) {
                            fullContent += content;
                            onStream(content);
                        }
                    } catch {
                        // Ignore parse errors for incomplete chunks
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return { content: fullContent };
    }

    private async chatOllama(
        baseUrl: string,
        messages: ChatMessage[],
        onStream?: (chunk: string) => void
    ): Promise<ChatCompletionResponse> {
        const url = `${baseUrl}/api/chat`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.config.model,
                messages,
                stream: !!onStream
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
        }

        if (onStream && response.body) {
            return this.handleOllamaStream(response.body, onStream);
        }

        const data = await response.json();
        return {
            content: data.message?.content || '',
            finishReason: data.done ? 'stop' : undefined
        };
    }

    private async handleOllamaStream(
        body: ReadableStream<Uint8Array>,
        onStream: (chunk: string) => void
    ): Promise<ChatCompletionResponse> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        const content = data.message?.content || '';
                        if (content) {
                            fullContent += content;
                            onStream(content);
                        }
                    } catch {
                        // Ignore parse errors
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return { content: fullContent };
    }

    async listModels(): Promise<ModelInfo[]> {
        const endpoint = getEndpointForProvider(this.config);

        try {
            if (this.config.type === 'ollama') {
                const response = await fetch(`${endpoint}/api/tags`);
                if (!response.ok) throw new Error('Failed to fetch models');
                const data = await response.json();
                return (data.models || []).map((m: { name: string }) => ({
                    id: m.name,
                    name: m.name
                }));
            } else {
                const response = await fetch(`${endpoint}/models`, {
                    headers: this.config.apiKey
                        ? { 'Authorization': `Bearer ${this.config.apiKey}` }
                        : {}
                });
                if (!response.ok) throw new Error('Failed to fetch models');
                const data = await response.json();
                return (data.data || []).map((m: { id: string }) => ({
                    id: m.id,
                    name: m.id
                }));
            }
        } catch (error) {
            console.error('Failed to list models:', error);
            return [];
        }
    }

    async testConnection(): Promise<{ success: boolean; message: string; models?: ModelInfo[] }> {
        try {
            const models = await this.listModels();
            if (models.length > 0) {
                return {
                    success: true,
                    message: `Connected! Found ${models.length} model(s)`,
                    models
                };
            }
            return {
                success: true,
                message: 'Connected but no models found',
                models: []
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Connection failed'
            };
        }
    }
}
