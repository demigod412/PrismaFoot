import "server-only";

export class ProviderError extends Error {
  constructor(public provider: string, public status: number, message: string) { super(message); }
}

/** Server-side JSON fetch: 12s timeout, 2 retries with backoff on 429/5xx, no Next data cache. */
export async function fetchJson<T>(provider: string, url: string, headers: Record<string, string>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await fetch(url, { headers, signal: ctl.signal, cache: "no-store" });
      if (res.status === 429 || res.status >= 500) {
        last = new ProviderError(provider, res.status, `${provider} ${res.status}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
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
