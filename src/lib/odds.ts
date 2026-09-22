import type { MarketKey } from "./markets";

/* Bookmaker odds → our market keys. Pure parsing so it can be unit-tested against sample payloads. */
export interface Quote { odds: number; best: number; books: number }
export type QuoteMap = Partial<Record<MarketKey, Quote>>;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Map one API-Football bet value to a market key (null = a market we don't price). */
export function apiFootballKey(betName: string, value: string): MarketKey | null {
  const b = betName.trim().toLowerCase(), v = value.trim().toLowerCase();
  if (b === "match winner") return v === "home" ? "home" : v === "draw" ? "draw" : v === "away" ? "away" : null;
  if (b === "double chance") return v === "home/draw" ? "dc_1x" : v === "draw/away" ? "dc_x2" : v === "home/away" ? "dc_12" : null;
  if (b === "both teams score") return v === "yes" ? "btts_yes" : v === "no" ? "btts_no" : null;
  if (b === "goals over/under") {
    const m = v.match(/^(over|under) (\d+(?:\.\d+)?)$/); if (!m) return null;
    const key = `${m[1]}${m[2].replace(".", "")}`;
    return (["over15", "over25", "over35", "under25", "under35", "under45"] as string[]).includes(key) ? (key as MarketKey) : null;
  }
  if (b === "asian handicap") return v === "home -1.5" ? "home_by2" : v === "away -1.5" ? "away_by2" : null;
  if (b === "corners over under") return v === "over 8.5" ? "corners_over" : v === "under 8.5" ? "corners_under" : null;
  return null;
}

type Bookmaker = { name: string; bets: { name: string; values: { value: string; odd: string }[] }[] };
/** API-Football /odds response items → fixture external id + quotes (median and best across bookmakers). */
export function parseApiFootballOdds(items: { fixture: { id: number }; bookmakers: Bookmaker[] }[]) {
  return items.map((it) => {
    const acc = new Map<MarketKey, number[]>();
    for (const bk of it.bookmakers ?? []) for (const bet of bk.bets ?? []) for (const val of bet.values ?? []) {
      const k = apiFootballKey(bet.name, String(val.value)); const o = Number(val.odd);
      if (!k || !(o > 1)) continue;
      acc.set(k, [...(acc.get(k) ?? []), o]);
    }
    const quotes: QuoteMap = {};
    acc.forEach((xs, k) => { quotes[k] = { odds: Math.round(median(xs) * 100) / 100, best: Math.max(...xs), books: xs.length }; });
    return { fixtureExt: String(it.fixture.id), quotes };
  });
}
