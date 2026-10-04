import type { AIResponse, AIStage, AIStreamEvent } from './types';

// One request, one quota reservation. Progress is application-stage feedback,
// not invented model percentages or extra provider calls.
export async function readAnalysisResponse(
  response: Response,
  onProgress: (stage: AIStage) => void,
): Promise<AIResponse> {
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('application/x-ndjson')
  ) {
    let result: AIResponse;
    try {
      result = await response.json();
    } catch {
      throw new Error('服务器没有返回有效结果；请稍后手动重试。');
    }
    if (!response.ok || result.error)
      throw new Error(result.error?.message || '分析失败，请稍后手动重试。');
    return result;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('未建立分析连接，请稍后手动重试。');
  const decoder = new TextDecoder();
  let buffer = '',
    size = 0;
  function consume(line: string): AIResponse | undefined {
    if (!line.trim()) return;
    let event: AIStreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('分析进度格式异常，已停止接收；没有自动重试。');
    }
    if (event.type === 'error')
      throw new Error(event.error?.message || '分析失败，没有自动重试。');
    if (event.type === 'result') return event.result;
    if (
      event.type === 'progress' &&
      ['validating', 'requesting', 'organizing'].includes(event.stage)
    )
      onProgress(event.stage);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const result = consume(buffer);
        if (result) return result;
        break;
      }
      size += value.byteLength;
      if (size > 150000)
        throw new Error('分析回复超过接收限制，已停止接收；没有自动重试。');
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const result = consume(line);
        if (result) return result;
      }
    }
    throw new Error(
      '连接在结果返回前中断；服务商可能已计费。问题和资料已保留，没有自动重试。',
    );
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* Connection may already be closed. */
    }
    reader.releaseLock();
  }
}
