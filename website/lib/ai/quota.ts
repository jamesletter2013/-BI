import { AIError } from './types';
import type { ProviderConfig } from './providers';

export function limits(env: ProviderConfig) {
  const bounded = (
    value: string | undefined,
    fallback: number,
    max: number,
  ): number | null => {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'unlimited') return null;
    return normalized && /^\d+$/.test(normalized)
      ? Math.max(1, Math.min(max, Number(normalized)))
      : fallback;
  };
  return {
    userDaily: bounded(env.AI_DAILY_USER_LIMIT, 20, 200),
    teamDaily: bounded(env.AI_DAILY_TEAM_LIMIT, 100, 1000),
  };
}
export async function actorHash(userId: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(userId),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function reserve(
  db: D1Database,
  requestId: string,
  actor: string,
  model: string,
  env: ProviderConfig,
  now = Date.now(),
) {
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10),
    limit = limits(env);
  // One atomic INSERT ... SELECT serializes quota and duplicate checks in D1.
  // Reservations count even when the provider fails; never auto-retry a billable call.
  const result = await db
    .prepare(`INSERT INTO ai_requests (request_id,actor,day,created_at,status,model)
    SELECT ?,?,?,?,'pending',? WHERE
      NOT EXISTS (SELECT 1 FROM ai_requests WHERE request_id=?)
      AND (? IS NULL OR (SELECT COUNT(*) FROM ai_requests WHERE day=?) < ?)
      AND (? IS NULL OR (SELECT COUNT(*) FROM ai_requests WHERE day=? AND actor=?) < ?)
      AND NOT EXISTS (SELECT 1 FROM ai_requests WHERE actor=? AND (created_at>? OR (status='pending' AND created_at>?)))
    ON CONFLICT(request_id) DO NOTHING`)
    .bind(
      requestId,
      actor,
      day,
      now,
      model,
      requestId,
      limit.teamDaily,
      day,
      limit.teamDaily,
      limit.userDaily,
      day,
      actor,
      limit.userDaily,
      actor,
      now - 15000,
      now - 120000,
    )
    .run();
  if (result.meta.changes !== 1) {
    if (limit.userDaily === null && limit.teamDaily === null)
      throw new AIError(
        429,
        'request_in_progress',
        '请勿重复提交；请等待当前分析结束，并与上次提交间隔至少 15 秒。每日调用次数不限。',
      );
    throw new AIError(
      429,
      'quota_or_duplicate',
      '重复提交、仍有分析进行中，或已达到今日使用上限。请等待后再试，必要时联系管理员。',
    );
  }
}
export async function finish(
  db: D1Database,
  requestId: string,
  status: 'success' | 'failed',
  inputTokens: number | null = null,
  outputTokens: number | null = null,
) {
  await db
    .prepare(
      'UPDATE ai_requests SET status=?,input_tokens=?,output_tokens=? WHERE request_id=?',
    )
    .bind(status, inputTokens, outputTokens, requestId)
    .run();
}
