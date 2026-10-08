// Integration boundary only. This module never chooses an AI vendor, stores
// credentials, changes a balance, or invents an endpoint on ai.taoa.cc.
export type HostAIStatus = {
  ready: boolean;
  message: string;
  usageNotice: string;
  termsVersion: string;
};
export type HostAIInput = {
  requestId: string;
  itemId: string;
  snapshot: unknown;
  history: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  expectedTermsVersion: string;
};
export type HostAIResult = {
  requestId: string;
  itemId: string;
  text: string;
  notice?: string;
};
export type HostAIAdapter = {
  getStatus(): Promise<HostAIStatus>;
  analyze(input: HostAIInput, options: {
    signal: AbortSignal;
    onProgress(stage: 'validating' | 'requesting' | 'organizing'): void;
  }): Promise<HostAIResult>;
};
export const HOST_AI_WAITING = '待接入 ai.taoa.cc 的统一 AI 服务，请由网站开发方完成对接。';
export async function readHostAIStatus(adapter?: HostAIAdapter | null): Promise<HostAIStatus> {
  if (!adapter) return { ready: false, message: HOST_AI_WAITING, usageNotice: '', termsVersion: '' };
  const status = await adapter.getStatus();
  if (!status || typeof status.ready !== 'boolean' || typeof status.message !== 'string'
    || typeof status.usageNotice !== 'string' || typeof status.termsVersion !== 'string'
    || (status.ready && (!status.termsVersion.trim() || !status.usageNotice.trim()))) {
    throw new Error('主站 AI 状态不完整，暂不发送分析。');
  }
  return status;
}
export async function analyzeWithHost(adapter: HostAIAdapter | null | undefined,
  input: HostAIInput, options: Parameters<HostAIAdapter['analyze']>[1]): Promise<HostAIResult> {
  if (!adapter) throw new Error(HOST_AI_WAITING);
  if (options.signal.aborted) throw new Error('已取消发送。');
  if (!input.expectedTermsVersion) throw new Error('请先读取主站使用规则。');
  const result = await adapter.analyze(input, options);
  if (options.signal.aborted) throw new Error('已停止等待，请到主站确认实际结果。');
  if (!result || result.requestId !== input.requestId || result.itemId !== input.itemId
    || typeof result.text !== 'string' || result.text.length > 150000) {
    throw new Error('主站返回结果与本次资料不一致，未替换建议。');
  }
  return result;
}
