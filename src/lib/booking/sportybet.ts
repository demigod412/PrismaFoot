import "server-only";
import type { MarketKey } from "../markets";

/*
 * Sportybet booking code — BEST EFFORT, UNOFFICIAL.
 * Sportybet has no public API. This uses the endpoints its own website uses:
 *   GET  /api/{region}/factsCenter/pcUpcomingEvents   (events + markets + outcome ids)
 *   POST /api/{region}/orders/share                   (creates a booking code; stakes nothing)
 * They can change without notice, may be unavailable from servers outside Nigeria, and a leg can fail to map.
 * Nothing here places a bet.
 */
const BASE = process.env.SPORTYBET_BASE_URL ?? "https://www.sportybet.com";
const REGION = (process.env.SPORTYBET_REGION ?? "ng").toLowerCase();
const HEADERS = {
  Accept: "application/json", "Content-Type": "application/json", "Current-Country": REGION.toUpperCase(),
  "User-Agent": "Mozilla/5.0 (PitchEdge booking helper)",
};
const MARKET_IDS = "1,10,18,29,16,14,166";

interface SbOutcome { id: string; desc: string; odds?: string; isActive?: number }
interface SbMarket { id: string; desc?: string; specifier?: string; status?: number; outcomes?: SbOutcome[] }
export interface SbEvent { eventId: string; homeTeamName: string; awayTeamName: string; estimateStartTime: number; markets?: SbMarket[] }

export interface BookLeg { fixtureId: string; market: MarketKey; home: string; away: string; kickoff: Date; label: string }
export interface Selection { eventId: string; marketId: string; specifier: string | null; outcomeId: string }

const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "club", "de", "the", "cd", "ud", "sd", "as", "ss", "calcio", "sv", "vfb", "vfl", "tsg", "fk", "if", "bk", "and", "&"]);
const ALIAS: Record<string, string> = { utd: "united", st: "saint", intl: "international", munchen: "munich", internazionale: "inter" };
export function normName(s: string): string[] {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w && !STOP.has(w)).map((w) => ALIAS[w] ?? w);
}
function nameScore(a: string, b: string): number {
  const x = normName(a), y = normName(b);
  if (!x.length || !y.length) return 0;
  const hit = x.filter((w) => y.some((v) => v === w || (w.length >= 3 && v.length >= 3 && (v.startsWith(w) || w.startsWith(v))))).length;
  return hit / Math.max(x.length, y.length);
}
/** Find the Sportybet event for a fixture: kickoff within 3 hours and both team names similar. */
export function matchEvent(events: SbEvent[], home: string, away: string, kickoff: Date): SbEvent | null {
  let best: { e: SbEvent; s: number } | null = null;
  for (const e of events) {
    if (Math.abs(e.estimateStartTime - kickoff.getTime()) > 3 * 3600_000) continue;
    const sh = nameScore(home, e.homeTeamName), sa = nameScore(away, e.awayTeamName);
    if (sh < 0.5 || sa < 0.5) continue; // both teams must match
    const s = sh + sa;
    if (!best || s > best.s) best = { e, s };
  }
  return best?.e ?? null;
}

const has = (d: string | undefined, ...words: string[]) => !!d && words.every((w) => d.toLowerCase().includes(w));
/** Map our market to Sportybet market/outcome ids using the event's own market list. */
export function resolveSelection(e: SbEvent, key: MarketKey): Selection | { error: string } {
  const ms = e.markets ?? [];
  const pick = (m: SbMarket | undefined, test: (o: SbOutcome) => boolean): Selection | { error: string } => {
    if (!m) return { error: "market not offered" };
    const o = (m.outcomes ?? []).find((x) => test(x) && x.isActive !== 0);
    return o ? { eventId: e.eventId, marketId: m.id, specifier: m.specifier ?? null, outcomeId: o.id } : { error: "selection not available" };
  };
  const total = (line: string) => ms.find((m) => m.id === "18" && m.specifier === `total=${line}`);
  switch (key) {
    case "home": return pick(ms.find((m) => m.id === "1"), (o) => o.id === "1" || has(o.desc, "home"));
    case "draw": return pick(ms.find((m) => m.id === "1"), (o) => o.id === "2" || has(o.desc, "draw"));
    case "away": return pick(ms.find((m) => m.id === "1"), (o) => o.id === "3" || has(o.desc, "away"));
    case "dc_1x": return pick(ms.find((m) => m.id === "10"), (o) => has(o.desc, "home", "draw"));
    case "dc_12": return pick(ms.find((m) => m.id === "10"), (o) => has(o.desc, "home", "away"));
    case "dc_x2": return pick(ms.find((m) => m.id === "10"), (o) => has(o.desc, "draw", "away"));
    case "over15": return pick(total("1.5"), (o) => has(o.desc, "over"));
    case "over25": return pick(total("2.5"), (o) => has(o.desc, "over"));
    case "over35": return pick(total("3.5"), (o) => has(o.desc, "over"));
    case "under25": return pick(total("2.5"), (o) => has(o.desc, "under"));
    case "under35": return pick(total("3.5"), (o) => has(o.desc, "under"));
    case "under45": return pick(total("4.5"), (o) => has(o.desc, "under"));
    case "btts_yes": return pick(ms.find((m) => m.id === "29"), (o) => has(o.desc, "yes"));
    case "btts_no": return pick(ms.find((m) => m.id === "29"), (o) => has(o.desc, "no"));
    case "home_by2": return pick(ms.find((m) => m.id === "16" && m.specifier === "hcp=-1.5"), (o) => has(o.desc, "home") || o.id === "1714");
    case "away_by2": return pick(ms.find((m) => m.id === "16" && m.specifier === "hcp=1.5"), (o) => has(o.desc, "away") || o.id === "1715");
    case "corners_over": return pick(ms.find((m) => has(m.desc, "corner") && m.specifier === "total=8.5"), (o) => has(o.desc, "over"));
    case "corners_under": return pick(ms.find((m) => has(m.desc, "corner") && m.specifier === "total=8.5"), (o) => has(o.desc, "under"));
    default: return { error: "market not supported by Sportybet export" };
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { ...init, headers: HEADERS, signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`Sportybet HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally { clearTimeout(t); }
}

/** Resolve every leg and request a booking code. Legs that can't be mapped are reported, never silently dropped. */
export async function sportybetBook(legs: BookLeg[]): Promise<{ code: string | null; url: string | null; unbookable: { label: string; reason: string }[] }> {
  const pending = new Map(legs.map((l) => [l.fixtureId, l]));
  const found = new Map<string, SbEvent>();
  const maxKick = Math.max(...legs.map((l) => l.kickoff.getTime()));
  const hours = Math.min(720, Math.max(24, Math.ceil((maxKick - Date.now()) / 3600_000) + 6));
  for (let page = 1; page <= 25 && pending.size; page++) {
    type Resp = { bizCode: number; data?: { totalNum?: number; tournaments?: { events: SbEvent[] }[] } };
    const r = await getJson<Resp>(`${BASE}/api/${REGION}/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=${MARKET_IDS}&pageSize=100&pageNum=${page}&todayGames=false&timeline=${hours}&_t=${Date.now()}`);
    if (r.bizCode !== 10000) throw new Error(`Sportybet returned code ${r.bizCode}`);
    const events = (r.data?.tournaments ?? []).flatMap((t) => t.events ?? []);
    if (!events.length) break;
    for (const [id, l] of pending) { const e = matchEvent(events, l.home, l.away, l.kickoff); if (e) { found.set(id, e); pending.delete(id); } }
    if (page * 100 >= (r.data?.totalNum ?? 0)) break;
    await new Promise((res) => setTimeout(res, 300));
  }
  const selections: Selection[] = [], unbookable: { label: string; reason: string }[] = [];
  for (const l of legs) {
    const e = found.get(l.fixtureId);
    if (!e) { unbookable.push({ label: `${l.home} v ${l.away}: ${l.label}`, reason: "match not found on Sportybet" }); continue; }
    const s = resolveSelection(e, l.market);
    if ("error" in s) unbookable.push({ label: `${l.home} v ${l.away}: ${l.label}`, reason: s.error }); else selections.push(s);
  }
  if (!selections.length) return { code: null, url: null, unbookable };
  type Share = { bizCode: number; message?: string; data?: { shareCode?: string; shareURL?: string; unavailableOutcomes?: unknown[] } };
  const res = await getJson<Share>(`${BASE}/api/${REGION}/orders/share`, { method: "POST", body: JSON.stringify({ selections }) });
  if (res.bizCode !== 10000 || !res.data?.shareCode) throw new Error(`Sportybet did not return a code (${res.message ?? res.bizCode})`);
  const un = res.data.unavailableOutcomes?.length ?? 0;
  if (un) unbookable.push({ label: `${un} selection(s)`, reason: "rejected by Sportybet as unavailable" });
  return { code: res.data.shareCode, url: res.data.shareURL ?? `${BASE}/${REGION}/?shareCode=${res.data.shareCode}`, unbookable };
}
