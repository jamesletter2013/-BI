export type AIModel = { id: string; label: string };
export type AIProviderInfo = {
  id: string;
  label: string;
  configured: boolean;
  models: AIModel[];
};
export type AIStatus = {
  enabled: boolean;
  authenticated: boolean;
  ready: boolean;
  message: string;
  providers: AIProviderInfo[];
  limits: {
    inputCharacters: number;
    outputTokens: number;
    userDaily: number;
    teamDaily: number;
  };
};
export type AIHistoryMessage = { role: 'user' | 'assistant'; content: string };
export type AIResponse = {
  itemId: string;
  requestId: string;
  provider: string;
  model: string;
  text: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  notice: string;
  error?: { message: string; code: string };
};
export type AIStage = 'validating' | 'requesting' | 'organizing';
export type AIStreamEvent =
  | { type: 'progress'; stage: AIStage; requestId?: string }
  | { type: 'result'; result: AIResponse }
  | {
      type: 'error';
      error: { message: string; code: string };
      requestId?: string;
      stage: AIStage;
    };
export class AIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AIError';
  }
}
