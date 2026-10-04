import {
  authorize,
  runtime,
  responseJSON,
  errorResponse,
} from '@/lib/ai/runtime';
import { readLimitedBody, resolveProvider } from '@/lib/ai/providers';
import {
  validateInput,
  analysisMessages,
  validateReply,
} from '@/lib/ai/service';
import { actorHash, reserve, finish } from '@/lib/ai/quota';
import {
  AIError,
  type AIStage,
  type AIStreamEvent,
  type AIResponse,
} from '@/lib/ai/types';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  // Reject unauthorized requests before starting a streaming response.
  let user: ReturnType<typeof authorize>;
  try {
    user = authorize(request);
  } catch (error) {
    return errorResponse(error);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) cancel();
  const streaming = request.headers
    .get('accept')
    ?.includes('application/x-ndjson');
  if (!streaming) {
    try {
      return responseJSON(await analyze(request, user, controller, () => {}));
    } catch (error) {
      return errorResponse(error);
    } finally {
      request.signal.removeEventListener('abort', cancel);
    }
  }
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async start(stream) {
      let stage: AIStage = 'validating',
        requestId: string | undefined;
      const emit = (event: AIStreamEvent) => {
        if (!closed)
          stream.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      try {
        const result = await analyze(request, user, controller, (next, id) => {
          stage = next;
          requestId = id;
          emit({ type: 'progress', stage, requestId });
        });
        emit({ type: 'result', result });
      } catch (error) {
        const safe =
          error instanceof AIError
            ? error
            : new AIError(
                503,
                'unavailable',
                '分析服务暂时不可用，问题和资料已保留；没有自动重试。',
              );
        // No credentials, prompts, response bodies or raw provider errors in logs.
        console.error(
          'ai_analysis_failed',
          JSON.stringify({ requestId, stage, code: safe.code }),
        );
        emit({
          type: 'error',
          error: { code: safe.code, message: safe.message },
          requestId,
          stage,
        });
      } finally {
        request.signal.removeEventListener('abort', cancel);
        if (!closed) {
          closed = true;
          stream.close();
        }
      }
    },
    cancel() {
      closed = true;
      controller.abort();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function analyze(
  request: Request,
  user: ReturnType<typeof authorize>,
  controller: AbortController,
  progress: (stage: AIStage, requestId?: string) => void,
): Promise<AIResponse & { suggestions: ReturnType<typeof validateReply> }> {
  let reservation: { db: D1Database; id: string } | undefined;
  try {
    progress('validating');
    const config = runtime();
    if (config.AI_ENABLED !== 'true')
      throw new AIError(
        503,
        'disabled',
        '管理员尚未启用 AI 调用，请继续使用手动草稿。',
      );
    if (!config.DB)
      throw new AIError(
        503,
        'quota_unavailable',
        '用量保护尚未就绪，未发送给 AI。',
      );
    let payload;
    try {
      payload = JSON.parse(await readLimitedBody(request, 240000));
    } catch (error) {
      if (error instanceof AIError) throw error;
      throw new AIError(400, 'invalid_json', '分析资料格式不正确。');
    }
    const input = validateInput(payload),
      provider = resolveProvider(input.providerId, input.modelId);
    if (!provider.configured(config))
      throw new AIError(
        503,
        'missing_key',
        '所选服务商尚未配置密钥，请联系管理员。',
      );
    if (controller.signal.aborted)
      throw new AIError(499, 'cancelled', '分析已取消，未发送给 AI。');
    try {
      await reserve(
        config.DB,
        input.requestId,
        await actorHash(user),
        `${input.providerId}/${input.modelId}`,
        config,
      );
    } catch (error) {
      if (error instanceof AIError) throw error;
      throw new AIError(
        503,
        'quota_unavailable',
        '额度检查失败，尚未调用 AI；请联系管理员。',
      );
    }
    reservation = { db: config.DB, id: input.requestId };
    const timer = setTimeout(() => controller.abort(), 90000);
    let result;
    try {
      if (controller.signal.aborted)
        throw new AIError(499, 'cancelled', '分析已取消。');
      progress('requesting', input.requestId);
      result = await provider.complete(
        config,
        input.modelId,
        analysisMessages(input),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted)
        throw new AIError(
          504,
          'timeout',
          '分析超时或已取消；没有自动重试。服务商可能已计费，资料仍保留。',
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
    progress('organizing', input.requestId);
    const suggestions = validateReply(result.text, input.itemId);
    await finish(
      config.DB,
      input.requestId,
      'success',
      result.inputTokens,
      result.outputTokens,
    );
    reservation = undefined;
    return {
      itemId: input.itemId,
      requestId: input.requestId,
      provider: provider.label,
      model: input.modelId,
      suggestions,
      text: JSON.stringify({ itemId: input.itemId, suggestions }, null, 2),
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      notice: '仅基于本次文字资料；AI 建议需人工核实，未查看图片。',
    };
  } catch (error) {
    if (reservation) {
      try {
        await finish(reservation.db, reservation.id, 'failed');
      } catch {
        /* Fail closed: the reservation continues to count. */
      }
    }
    throw error;
  }
}
