/** fetch() rejects with a TypeError when there is no connection. */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TypeError) return true;
  const message = String((error as { message?: unknown })?.message ?? error);
  return /network request failed|network error|failed to fetch|timed? ?out/i.test(message);
}

export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
