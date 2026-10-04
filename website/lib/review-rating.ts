// Platform rateType only. Neither text sentiment nor a request's filter scope
// establishes the rating of an individual record.
export type ReviewRating = 'good' | 'neutral' | 'bad' | 'unknown';
export const ratingLabels: Record<ReviewRating, string> = { good: '好评', neutral: '中评', bad: '差评', unknown: '未标明' };
export function reviewRating(rateType: unknown): ReviewRating {
  if (rateType === '1' || rateType === 1) return 'good';
  if (rateType === '0' || rateType === 0) return 'neutral';
  if (rateType === '-1' || rateType === -1) return 'bad';
  return 'unknown';
}
export function ratingCounts(rows: { rateType: unknown }[]) {
  const counts = { good: 0, neutral: 0, bad: 0, unknown: 0 };
  for (const row of rows) counts[reviewRating(row.rateType)]++;
  return counts;
}
