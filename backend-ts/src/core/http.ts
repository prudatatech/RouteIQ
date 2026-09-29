/**
 * margixindia — outbound HTTP for third-party APIs.
 *
 * Every call to Google, TomTom and OpenWeather goes through
 * `externalHttp.getJson`, so tests replace this one function and never
 * reach a live service.
 */
export const externalHttp = {
  async getJson<T = any>(url: string, timeoutMs = 8000): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    return (await res.json()) as T;
  },

  async postJson<T = any>(url: string, body: unknown, timeoutMs = 10_000): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    return (await res.json()) as T;
  },
};
