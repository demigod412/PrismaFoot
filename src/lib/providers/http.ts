import "server-only";

/**
 * Provider HTTP requests made in this process, for the quota line in each sync report.
 * Counts every attempt, including the retry after a 429, because the provider counts those too.
 */
let calls = 0;
export const providerCalls = { get: () => calls, reset: () => { calls = 0; } };

export class ProviderError extends Error {
  constructor(public provider: string, public status: number, message: string) { super(message); }
}

/**
 * Server-side JSON fetch: 12s timeout, no Next data cache.
 * 5xx → short backoff. 429 → wait for the provider's own window (Retry-After, else a full minute),
 * because football-data.org counts 10 requests per MINUTE: a 1-second retry is always rejected again.
 */
export async function fetchJson<T>(provider: string, url: string, headers: Record<string, string>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      calls++;
      const res = await fetch(url, { headers, signal: ctl.signal, cache: "no-store" });
      if (res.status === 429 || res.status >= 500) {
        last = new ProviderError(provider, res.status, `${provider} ${res.status}`);
        const retryAfter = Number(res.headers.get("Retry-After")) || 0;
        const wait = res.status === 429 ? Math.min(90_000, (retryAfter ? retryAfter + 1 : 62) * 1000) : 1000 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new ProviderError(provider, res.status, `${provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      if (e instanceof ProviderError && e.status < 500 && e.status !== 429) throw e;
    } finally { clearTimeout(timer); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
