// Hide only the collector's reference-date suffix; keep raw capture data intact.
export function categoryDisplayName(path?: string): string {
  return (path || '').replace(/\s*（本地表参考[·:：]\s*\d{4}-\d{2}-\d{2}）\s*$/u, '');
}
