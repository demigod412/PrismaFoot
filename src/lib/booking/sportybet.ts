import "server-only";
import { MULTISCORES, parseLineKey, type MarketKey } from "../markets";

/*
 * Sportybet booking code — BEST EFFORT, UNOFFICIAL.
 * Sportybet has no public API. This uses the endpoints its own website uses:
 *   GET  /api/{region}/factsCenter/pcUpcomingEvents   (events, to find each match)
 *   GET  /api/{region}/factsCenter/event              (one match with its FULL market list)
 *   POST /api/{region}/orders/share                   (creates a booking code; stakes nothing)
 * They can change without notice, may be unavailable from servers outside Nigeria, and a leg can fail to map.
 * Nothing here places a bet. `npm run sportycheck` prints what Sportybet returns for a match.
 *
 * Why legs used to fail while the option was plainly on Sportybet: the upcoming-events list carries only
 * each market's MAIN line (Over/Under 2.5, not 1.5 or 3.5; one corner line), and the half-time 1X2 market
 * was never requested at all. Every leg is now resolved against the match's own full market list, with the
 * list's markets as a fallback.
 */
const BASE = process.env.SPORTYBET_BASE_URL ?? "https://www.sportybet.com";
const REGION = (process.env.SPORTYBET_REGION ?? "ng").toLowerCase();
const HEADERS = {
  Accept: "application/json", "Content-Type": "application/json", "Current-Country": REGION.toUpperCase(),
  "User-Agent": "Mozilla/5.0 (PitchEdge booking helper)",
};
// 1 1X2 · 10 double chance · 18 total · 29 BTTS · 16/14 handicaps · 60 1st-half 1X2 · 68/90 half totals · 166 corners
const MARKET_IDS = "1,10,18,29,16,14,60,68,90,166";

interface SbOutcome { id: string; desc: string; odds?: string; isActive?: number }
interface SbMarket { id: string; desc?: string; name?: string; specifier?: string; status?: number; outcomes?: SbOutcome[] }
export interface SbEvent { eventId: string; homeTeamName: string; awayTeamName: string; estimateStartTime: number; markets?: SbMarket[] }

export interface BookLeg { fixtureId: string; market: MarketKey; home: string; away: string; kickoff: Date; label: string }
export interface Selection { eventId: string; marketId: string; specifier: string | null; outcomeId: string }

const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "club", "de", "the", "cd", "ud", "sd", "as", "ss", "calcio", "sv", "vfb", "vfl", "tsg", "fk", "if", "bk", "and", "&",
  "sk", "nk", "rc", "rcd", "ca", "cs", "ks", "jk", "ik", "aik", "ff", "fbc", "bsc", "spvgg", "sl", "sporting"]);
const ALIAS: Record<string, string> = {
  utd: "united", st: "saint", intl: "international", munchen: "munich", internazionale: "inter",
  wolves: "wolverhampton", spurs: "tottenham", psg: "paris", gladbach: "monchengladbach", atl: "atletico",
  man: "manchester", nott: "nottingham", sheff: "sheffield", wed: "wednesday", qpr: "queens", mk: "milton",
};
export function normName(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w && !STOP.has(w)).map((w) => ALIAS[w] ?? w);
}
function nameScore(a: string, b: string): number {
  const x = normName(a), y = normName(b);
  if (!x.length || !y.length) return 0;
  const hit = x.filter((w) => y.some((v) => v === w || (w.length >= 3 && v.length >= 3 && (v.startsWith(w) || w.startsWith(v))))).length;
  const yHit = y.filter((v) => x.some((w) => v === w || (w.length >= 3 && v.length >= 3 && (v.startsWith(w) || w.startsWith(v))))).length;
  // Scored against the SHORTER name too, so "Wolverhampton Wanderers" still matches Sportybet's "Wolves".
  return Math.max(hit / Math.max(x.length, y.length), Math.min(hit, yHit) / Math.min(x.length, y.length) * 0.9);
}
/**
 * Find the Sportybet event for a fixture: kickoff within 3 hours and both team names similar.
 * Fallback for awkward names: kickoff within 20 minutes, ONE side clearly matching and the other partly,
 * accepted only when exactly one event fits that way.
 */
export function matchEvent(events: SbEvent[], home: string, away: string, kickoff: Date): SbEvent | null {
  let best: { e: SbEvent; s: number } | null = null;
  const loose: SbEvent[] = [];
  for (const e of events) {
    const dt = Math.abs(e.estimateStartTime - kickoff.getTime());
    if (dt > 3 * 3600_000) continue;
    const sh = nameScore(home, e.homeTeamName), sa = nameScore(away, e.awayTeamName);
    if (sh >= 0.5 && sa >= 0.5) { const s = sh + sa; if (!best || s > best.s) best = { e, s }; continue; }
    if (dt <= 20 * 60_000 && ((sh >= 0.75 && sa >= 0.25) || (sa >= 0.75 && sh >= 0.25))) loose.push(e);
  }
  return best?.e ?? (loose.length === 1 ? loose[0] : null);
}

const lc = (s: string | undefined) => (s ?? "").toLowerCase();
const has = (d: string | undefined, ...words: string[]) => !!d && words.every((w) => lc(d).includes(w));
const mDesc = (m: SbMarket) => lc(m.desc ?? m.name);
/** The set of exact scores an outcome names ("1:0, 2:0 or 3:0" → {1-0, 2-0, 3-0}), or null if it names none. */
export function scoresOf(desc: string): Set<string> | null {
  const xs = [...desc.matchAll(/(\d+)\s*[:-]\s*(\d+)/g)].map((m) => `${m[1]}-${m[2]}`);
  return xs.length ? new Set(xs) : null;
}

/** Map our market to Sportybet market/outcome ids using the event's own market list. */
export function resolveSelection(e: SbEvent, key: MarketKey): Selection | { error: string } {
  const ms = e.markets ?? [];
  const active = (o: SbOutcome) => o.isActive !== 0;
  const sel = (m: SbMarket, o: SbOutcome): Selection => ({ eventId: e.eventId, marketId: m.id, specifier: m.specifier ?? null, outcomeId: o.id });
  /** First market (in the order given) carrying an active outcome that passes `test`. */
  const pick = (wanted: string, cands: (SbMarket | undefined)[], test: (o: SbOutcome) => boolean): Selection | { error: string } => {
    const found = cands.filter((m): m is SbMarket => !!m);
    if (!found.length) return { error: `market not offered (${wanted})` };
    for (const m of found) { const o = (m.outcomes ?? []).find((x) => test(x) && active(x)); if (o) return sel(m, o); }
    return { error: `selection not available (${wanted})` };
  };
  const byId = (id: string, spec?: string) => ms.find((m) => m.id === id && (spec === undefined ? !m.specifier || m.specifier === "" : m.specifier === spec));
  const total = (line: string) => byId("18", `total=${line}`);
  const ou = (side: "over" | "under") => (o: SbOutcome) => has(o.desc, side) || o.id === (side === "over" ? "12" : "13");
  const eq = (o: SbOutcome, ...words: string[]) => words.includes(lc(o.desc).trim());

  const onLine = parseLineKey(key);
  if (onLine) {
    if (onLine.base === "shots") return { error: "total shots aren't offered on Sportybet" };
    const word = onLine.base === "corners" ? "corner" : "tackle";
    const lineMarkets = ms.filter((m) => m.specifier === `total=${onLine.line}` && mDesc(m).includes(word) && !/1st|2nd|half|team|home|away/.test(mDesc(m)));
    return pick(`${onLine.base} ${onLine.side} ${onLine.line}`, [onLine.base === "corners" ? byId("166", `total=${onLine.line}`) : undefined, ...lineMarkets], ou(onLine.side));
  }
  const ms1 = MULTISCORES.find((x) => x.key === key);
  if (ms1) {
    // Any market whose outcome names exactly these scores: Sportybet's "Multiscores" carries 1-0/2-0/3-0
    // and 2-1/3-1/4-1 (and the away mirrors); a set it does not offer is reported, never approximated.
    const want = new Set(ms1.scores.map(([h, a]) => `${h}-${a}`));
    for (const m of ms) for (const o of m.outcomes ?? []) {
      const got = scoresOf(o.desc);
      if (got && active(o) && got.size === want.size && [...want].every((s) => got.has(s))) return sel(m, o);
    }
    return { error: `Sportybet doesn't offer ${[...want].join("/")} as one selection` };
  }
  switch (key) {
    case "ht_draw": return pick("1st half 1X2", [byId("60"), ...ms.filter((m) => /1st half/.test(mDesc(m)) && /1x2|result/.test(mDesc(m)))], (o) => o.id === "2" || eq(o, "draw", "x"));
    case "h1_under15": return pick("1st half total 1.5", [byId("68", "total=1.5")], ou("under"));
    case "h1_under25": return pick("1st half total 2.5", [byId("68", "total=2.5")], ou("under"));
    case "h2_under25": return pick("2nd half total 2.5", [byId("90", "total=2.5")], ou("under"));
    case "home": return pick("1X2", [byId("1")], (o) => o.id === "1" || eq(o, "home", "1"));
    case "draw": return pick("1X2", [byId("1")], (o) => o.id === "2" || eq(o, "draw", "x"));
    case "away": return pick("1X2", [byId("1")], (o) => o.id === "3" || eq(o, "away", "2"));
    case "dc_1x": return pick("double chance", [byId("10")], (o) => o.id === "9" || has(o.desc, "home", "draw") || eq(o, "1x", "1/x"));
    case "dc_12": return pick("double chance", [byId("10")], (o) => o.id === "10" || has(o.desc, "home", "away") || eq(o, "12", "1/2"));
    case "dc_x2": return pick("double chance", [byId("10")], (o) => o.id === "11" || has(o.desc, "draw", "away") || eq(o, "x2", "x/2"));
    case "over15": return pick("over/under 1.5", [total("1.5")], ou("over"));
    case "over25": return pick("over/under 2.5", [total("2.5")], ou("over"));
    case "over35": return pick("over/under 3.5", [total("3.5")], ou("over"));
    case "under25": return pick("over/under 2.5", [total("2.5")], ou("under"));
    case "under35": return pick("over/under 3.5", [total("3.5")], ou("under"));
    case "under45": return pick("over/under 4.5", [total("4.5")], ou("under"));
    case "btts_yes": return pick("GG/NG", [byId("29")], (o) => o.id === "74" || eq(o, "yes", "gg"));
    case "btts_no": return pick("GG/NG", [byId("29")], (o) => o.id === "76" || eq(o, "no", "ng"));
    case "no_gg2": case "gg2": {
      // "GG/NG 2+": both teams to score two or more. Found by its name; outcome "No"/"NG" for No GG2+.
      const cands = ms.filter((m) => /2\+|two or more|2 or more/.test(mDesc(m)) && /(gg|both teams)/.test(mDesc(m)) && !/half/.test(mDesc(m)));
      return pick("GG/NG 2+", cands, (o) => (key === "no_gg2" ? eq(o, "no", "ng") : eq(o, "yes", "gg")));
    }
    // Win by 2+: the Asian line -1.5, or the European handicap 0:1 (home) / 1:0 (away), whichever is listed.
    case "home_by2": return pick("handicap -1.5", [byId("16", "hcp=-1.5"), byId("14", "hcp=0:1")], (o) => o.id === "1714" || o.id === "1711" || has(o.desc, "home") || eq(o, "1"));
    case "away_by2": return pick("handicap +1.5", [byId("16", "hcp=1.5"), byId("14", "hcp=1:0")], (o) => o.id === "1715" || o.id === "1713" || has(o.desc, "away") || eq(o, "2"));
    case "corners_over": case "corners_under": return { error: "old fixed-line corner pick; add the corner line again from the match page" };
    case "home_or_over25": case "away_or_over25": return { error: "\"win or over\" isn't offered as one selection on Sportybet" };
    default: return { error: "market not supported by Sportybet export" };
  }
}

async function getJson<T>(url: string, init?: RequestInit, tries = 2): Promise<T> {
  let last: Error = new Error("no attempt");
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(url, { ...init, headers: HEADERS, signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`Sportybet HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      last = (e as Error).name === "AbortError" ? new Error("Sportybet timed out") : (e as Error);
      if (i + 1 < tries) await new Promise((res) => setTimeout(res, 700));
    } finally { clearTimeout(t); }
  }
  throw last;
}

/** One match with every market Sportybet lists for it (null if the endpoint gives nothing usable). */
export async function eventDetail(eventId: string): Promise<SbEvent | null> {
  try {
    const r = await getJson<{ bizCode: number; data?: SbEvent }>(`${BASE}/api/${REGION}/factsCenter/event?eventId=${encodeURIComponent(eventId)}&productId=3&_t=${Date.now()}`);
    return r.bizCode === 10000 && r.data?.markets?.length ? r.data : null;
  } catch { return null; }
}

/** Upcoming events, paged until every leg's match is found. A failed page ends the search, keeping what was found. */
export async function findEvents(legs: { fixtureId: string; home: string; away: string; kickoff: Date }[]) {
  const pending = new Map(legs.map((l) => [l.fixtureId, l]));
  const found = new Map<string, SbEvent>();
  let error: string | null = null, scanned = 0;
  const sample: string[] = [];
  if (!legs.length) return { found, error, scanned, sample };
  const maxKick = Math.max(...legs.map((l) => l.kickoff.getTime()));
  const hours = Math.min(720, Math.max(24, Math.ceil((maxKick - Date.now()) / 3600_000) + 6));
  for (let page = 1; page <= 30 && pending.size; page++) {
    type Resp = { bizCode: number; data?: { totalNum?: number; tournaments?: { events: SbEvent[] }[] } };
    let r: Resp;
    try {
      r = await getJson<Resp>(`${BASE}/api/${REGION}/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=${MARKET_IDS}&pageSize=100&pageNum=${page}&todayGames=false&timeline=${hours}&_t=${Date.now()}`);
    } catch (e) { error = (e as Error).message; break; }
    if (r.bizCode !== 10000) { error = `Sportybet returned code ${r.bizCode}`; break; }
    const events = (r.data?.tournaments ?? []).flatMap((t) => t.events ?? []);
    scanned += events.length;
    for (const e of events) if (sample.length < 5) sample.push(`${e.homeTeamName} v ${e.awayTeamName}`);
    if (!events.length) break;
    for (const [id, l] of pending) { const e = matchEvent(events, l.home, l.away, l.kickoff); if (e) { found.set(id, e); pending.delete(id); } }
    if (page * 100 >= (r.data?.totalNum ?? 0)) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  return { found, error, scanned, sample };
}

/** Resolve every leg and request a booking code. Legs that can't be mapped are reported, never silently dropped. */
export async function sportybetBook(legs: BookLeg[]): Promise<{ code: string | null; url: string | null; unbookable: { label: string; reason: string }[] }> {
  const { found, error } = await findEvents(legs);
  if (!found.size && error) throw new Error(error);
  // Full market list per matched event: the list only carries main lines.
  const detail = new Map<string, SbEvent>();
  for (const e of new Set(found.values())) {
    if (detail.has(e.eventId)) continue;
    const d = await eventDetail(e.eventId);
    detail.set(e.eventId, d ? { ...e, ...d, markets: [...(d.markets ?? []), ...(e.markets ?? [])] } : e);
    await new Promise((res) => setTimeout(res, 150));
  }
  const selections: Selection[] = [], unbookable: { label: string; reason: string }[] = [];
  const legOf = new Map<string, string>();
  for (const l of legs) {
    const e = found.get(l.fixtureId);
    const label = `${l.home} v ${l.away}: ${l.label}`;
    if (!e) { unbookable.push({ label, reason: error ? `match not found (Sportybet search stopped early: ${error})` : "match not found on Sportybet" }); continue; }
    const s = resolveSelection(detail.get(e.eventId) ?? e, l.market);
    if ("error" in s) unbookable.push({ label, reason: s.error });
    else { selections.push(s); legOf.set(`${s.eventId}|${s.marketId}|${s.outcomeId}`, label); }
  }
  if (!selections.length) return { code: null, url: null, unbookable };
  type Unavail = { eventId?: string; marketId?: string; outcomeId?: string } | string;
  type Share = { bizCode: number; message?: string; data?: { shareCode?: string; shareURL?: string; unavailableOutcomes?: Unavail[] } };
  const res = await getJson<Share>(`${BASE}/api/${REGION}/orders/share`, { method: "POST", body: JSON.stringify({ selections }) });
  if (res.bizCode !== 10000 || !res.data?.shareCode) throw new Error(`Sportybet did not return a code (${res.message ?? res.bizCode})`);
  for (const u of res.data.unavailableOutcomes ?? []) {
    const k = typeof u === "string" ? null : `${u.eventId}|${u.marketId}|${u.outcomeId}`;
    unbookable.push({ label: (k && legOf.get(k)) ?? "1 selection", reason: "rejected by Sportybet as unavailable (suspended or price withdrawn)" });
  }
  return { code: res.data.shareCode, url: res.data.shareURL ?? `${BASE}/${REGION}/?shareCode=${res.data.shareCode}`, unbookable };
}
