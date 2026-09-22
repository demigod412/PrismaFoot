import { describe, expect, it } from "vitest";
import { brier, computeAccuracy, devig, tableFavourites, type ScoredCall } from "@/lib/accuracy";
import { apiFootballKey, parseApiFootballOdds } from "@/lib/odds";
import { flatStakeRoi, selectTopValue, valueTips } from "@/lib/value";
import { addLeg, combinedP, dropLowConfidence, dropWeakest, mergeSlips, splitInTwo, trimToTarget, type Leg } from "@/lib/slips";
import { fitLeague, type HistMatch } from "@/lib/model/ratings";
import { allMarkets } from "@/lib/markets";
import { makeRng, poissonSample } from "@/lib/demo/rng";

// server-only guard is irrelevant in tests
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
const { matchEvent, resolveSelection, normName } = await import("@/lib/booking/sportybet");

const pred = (o: Record<string, unknown> = {}) => ({
  band: "MEDIUM", confidence: 60, calHome: 0.55, calDraw: 0.25, calAway: 0.2, calOver15: 0.75, calOver25: 0.5, calOver35: 0.26, calOver45: 0.11,
  calBtts: 0.5, calHomeBy2: 0.3, calAwayBy2: 0.06, calCornersOver: null, cornersLine: null, calShotsOver: null, shotsLine: null, ...o,
}) as never;

describe("accuracy", () => {
  const call = (cal: [number, number, number], h: number, a: number, extra: Partial<ScoredCall> = {}): ScoredCall => ({
    fixtureId: Math.random().toString(), leagueId: "L", kickoff: new Date("2026-09-01T15:00:00Z"), band: "MEDIUM", cal, raw: cal, h, a,
    markets: allMarkets(pred({ calHome: cal[0], calDraw: cal[1], calAway: cal[2] }), "H", "A"), tableFav: 0, closing: null, ...extra,
  });
  it("brier and baselines", () => {
    expect(brier([1, 0, 0], 0)).toBe(0);
    expect(brier([1 / 3, 1 / 3, 1 / 3], 1)).toBeCloseTo(2 / 3, 9);
    const r = computeAccuracy([call([0.6, 0.25, 0.15], 2, 0), call([0.2, 0.3, 0.5], 0, 1), call([0.45, 0.3, 0.25], 1, 1)]);
    expect(r.n).toBe(3);
    expect(r.model.hit).toBeCloseTo(2 / 3, 9);
    expect(r.alwaysHome.brier).toBeCloseTo((0 + 2 + 2) / 3, 9);
    expect(r.model.brier).toBeLessThan(r.alwaysHome.brier);
    expect(r.tableFav.covered).toBe(3);
  });
  it("market baseline uses only calls with odds", () => {
    const r = computeAccuracy([call([0.6, 0.25, 0.15], 2, 0, { closing: devig([1.6, 4, 6]) }), call([0.5, 0.3, 0.2], 0, 2)]);
    expect(r.market?.n).toBe(1);
  });
  it("devig sums to 1", () => { const p = devig([1.9, 3.6, 4.2]); expect(p[0] + p[1] + p[2]).toBeCloseTo(1, 12); });
  it("table favourite needs a table", () => {
    const res = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, leagueId: "L", kickoff: new Date(2026, 7, i + 1), homeId: i % 2 ? "A" : "B", awayId: i % 2 ? "C" : "D", h: i % 2 ? 2 : 0, a: 0 }));
    const f = tableFavourites(res, [{ id: "t", leagueId: "L", kickoff: new Date(2026, 8, 1), homeId: "A", awayId: "B" }, { id: "early", leagueId: "L", kickoff: new Date(2026, 7, 3), homeId: "A", awayId: "B" }]);
    expect(f.get("t")).toBe(0); expect(f.get("early")).toBeNull();
  });
});

describe("odds + value", () => {
  it("maps API-Football bets to markets", () => {
    expect(apiFootballKey("Match Winner", "Home")).toBe("home");
    expect(apiFootballKey("Double Chance", "Draw/Away")).toBe("dc_x2");
    expect(apiFootballKey("Goals Over/Under", "Under 3.5")).toBe("under35");
    expect(apiFootballKey("Goals Over/Under", "Over 5.5")).toBeNull();
    expect(apiFootballKey("Asian Handicap", "Away -1.5")).toBe("away_by2");
    expect(apiFootballKey("Corners Over Under", "Over 8.5")).toBe("corners_over");
  });
  it("takes the median across bookmakers", () => {
    const [x] = parseApiFootballOdds([{ fixture: { id: 7 }, bookmakers: [1.8, 1.9, 2.1].map((o) => ({ name: "b", bets: [{ name: "Match Winner", values: [{ value: "Home", odd: String(o) }] }] })) }]);
    expect(x.fixtureExt).toBe("7"); expect(x.quotes.home).toEqual({ odds: 1.9, best: 2.1, books: 3 });
  });
  it("finds value only where p × odds − 1 ≥ 3%", () => {
    const tips = valueTips(pred(), { home: { odds: 2.0, best: 2.1, books: 5 }, away: { odds: 4.5, best: 4.8, books: 5 }, over25: { odds: 1.9, best: 2, books: 5 } }, "H", "A");
    expect(tips.map((t) => t.key)).toEqual(["home"]); // 0.55×2.0−1 = 10%; away 0.2×4.5−1 < 0; over25 0.5×1.9−1 < 0
    expect(tips[0].edge).toBeCloseTo(0.1, 9);
    expect(valueTips(pred({ band: "LOW" }), { home: { odds: 3, best: 3, books: 1 } }, "H", "A")).toEqual([]);
    const top = selectTopValue([{ item: 1, id: "a", startMs: 0, tips }, { item: 2, id: "b", startMs: 0, tips: [] }]);
    expect(top).toHaveLength(1);
  });
  it("flat-stake ROI", () => { const r = flatStakeRoi([{ odds: 2, hit: true }, { odds: 3, hit: false }]); expect(r.profit).toBe(0); expect(r.roi).toBe(0); });
});

describe("slips", () => {
  const leg = (id: string, p: number, band = "MEDIUM"): Leg => ({ fixtureId: id, market: "home", label: "x", match: id, kickoff: new Date().toISOString(), p, band, addedAt: "" });
  it("one leg per match, optimise, split, merge", () => {
    let legs: Leg[] = [];
    legs = addLeg(legs, leg("a", 0.8)).legs; legs = addLeg(legs, leg("b", 0.6)).legs;
    const r = addLeg(legs, leg("a", 0.7)); expect(r.replaced).toBe(true); expect(r.legs).toHaveLength(2);
    expect(combinedP(r.legs)).toBeCloseTo(0.42, 9);
    expect(dropWeakest(r.legs).dropped?.fixtureId).toBe("b");
    expect(dropLowConfidence([leg("x", 0.9, "LOW"), leg("y", 0.5)]).legs).toHaveLength(1);
    expect(trimToTarget([leg("a", 0.9), leg("b", 0.5), leg("c", 0.6)], 0.5).legs.map((l) => l.fixtureId)).toEqual(["a", "c"]);
    const [x, y] = splitInTwo([leg("a", 0.9), leg("b", 0.8), leg("c", 0.7), leg("d", 0.6)]);
    expect(x.map((l) => l.fixtureId)).toEqual(["a", "c"]); expect(y.map((l) => l.fixtureId)).toEqual(["b", "d"]);
    const m = mergeSlips([leg("a", 0.6)], [leg("a", 0.7), leg("z", 0.5)]);
    expect(m.duplicates).toEqual(["a"]); expect(m.legs.find((l) => l.fixtureId === "a")?.p).toBe(0.7); expect(m.legs).toHaveLength(2);
  });
});

describe("sportybet mapping", () => {
  const ev = { eventId: "sr:match:1", homeTeamName: "Arsenal", awayTeamName: "Manchester United", estimateStartTime: Date.UTC(2026, 9, 10, 14),
    markets: [
      { id: "1", outcomes: [{ id: "1", desc: "Home" }, { id: "2", desc: "Draw" }, { id: "3", desc: "Away" }] },
      { id: "10", outcomes: [{ id: "9", desc: "Home or Draw" }, { id: "10", desc: "Home or Away" }, { id: "11", desc: "Draw or Away" }] },
      { id: "18", specifier: "total=2.5", outcomes: [{ id: "12", desc: "Over 2.5" }, { id: "13", desc: "Under 2.5" }] },
      { id: "29", outcomes: [{ id: "74", desc: "Yes" }, { id: "76", desc: "No" }] },
    ] };
  it("normalises names and matches events by time + names", () => {
    expect(normName("Arsenal FC")).toEqual(["arsenal"]);
    expect(matchEvent([ev], "Arsenal FC", "Manchester United FC", new Date(Date.UTC(2026, 9, 10, 14, 0)))?.eventId).toBe("sr:match:1");
    expect(matchEvent([ev], "Chelsea FC", "Manchester United FC", new Date(Date.UTC(2026, 9, 10, 14, 0)))).toBeNull();
    expect(matchEvent([ev], "Arsenal FC", "Manchester United FC", new Date(Date.UTC(2026, 9, 11, 14, 0)))).toBeNull();
  });
  it("resolves our markets to outcome ids and reports gaps", () => {
    expect(resolveSelection(ev, "dc_x2")).toEqual({ eventId: "sr:match:1", marketId: "10", specifier: null, outcomeId: "11" });
    expect(resolveSelection(ev, "under25")).toMatchObject({ marketId: "18", specifier: "total=2.5", outcomeId: "13" });
    expect(resolveSelection(ev, "btts_no")).toMatchObject({ outcomeId: "76" });
    expect(resolveSelection(ev, "corners_over")).toEqual({ error: "market not offered" });
    expect(resolveSelection(ev, "shots_over")).toMatchObject({ error: expect.any(String) });
  });
});

describe("priors for new teams", () => {
  it("a newcomer with no matches gets its prior, not league average", () => {
    const rng = makeRng(4), ms: HistMatch[] = [];
    for (let i = 0; i < 300; i++) { const h = `t${i % 10}`, a = `t${(i * 7 + 3) % 10}`; if (h === a) continue; ms.push({ homeId: h, awayId: a, date: new Date(Date.UTC(2026, 0, 1) + i * 864e5 / 2), homeGoals: poissonSample(rng, 1.5), awayGoals: poissonSample(rng, 1.1) }); }
    const fit = fitLeague(ms, new Date(Date.UTC(2026, 8, 1)), { priors: new Map([["new", { a: 0.85, d: 1.15, weight: 8 }]]) });
    const t = fit.teams.get("new")!;
    expect(t.attack / fit.base).toBeLessThan(0.95);
    expect(t.defence).toBeGreaterThan(1.05);
  });
  it("previous-season weight lowers influence", () => {
    const base: HistMatch = { homeId: "A", awayId: "B", date: new Date(Date.UTC(2026, 7, 1)), homeGoals: 3, awayGoals: 0 };
    const w1 = fitLeague([base, { ...base, homeId: "B", awayId: "A", homeGoals: 0, awayGoals: 0 }], new Date(Date.UTC(2026, 8, 1)));
    const w2 = fitLeague([{ ...base, weight: 0.3 }, { ...base, homeId: "B", awayId: "A", homeGoals: 0, awayGoals: 0 }], new Date(Date.UTC(2026, 8, 1)));
    expect(w2.teams.get("A")!.attack).toBeLessThan(w1.teams.get("A")!.attack);
  });
});

describe("sportybet name variants", () => {
  it("matches common abbreviations", () => {
    const e = { eventId: "x", homeTeamName: "Man Utd", awayTeamName: "Nottingham Forest", estimateStartTime: Date.UTC(2026, 9, 10, 14) };
    expect(matchEvent([e], "Manchester United FC", "Nottingham Forest FC", new Date(Date.UTC(2026, 9, 10, 14)))?.eventId).toBe("x");
  });
});

import { isDayKey } from "@/lib/time";
describe("date param", () => {
  it("accepts only real dates", () => {
    expect(isDayKey("2026-10-06")).toBe(true);
    for (const bad of ["2026-13-45", "2026-02-30", "garbage", "", undefined, "2026-1-5"]) expect(isDayKey(bad as string)).toBe(false);
  });
});

import { halfUnders, winOrOver, scoreMatrix } from "@/lib/model/dixonColes";
import { marketHit } from "@/lib/markets";
import { bestTip, selectTop, tipsFor } from "@/lib/top";
describe("halves and win-or-over", () => {
  const m = scoreMatrix(1.5, 1.1, -0.08);
  it("half unders are coherent", () => {
    const h = halfUnders(m, 0.45);
    expect(h.h1u15).toBeLessThan(h.h1u25);
    expect(h.h1u25).toBeGreaterThan(h.h2u25); // fewer goals before half-time
    expect(h.h1u15).toBeGreaterThan(0.5); expect(h.h1u25).toBeLessThan(0.97);
  });
  it("win or over ≥ each of its parts", () => {
    const w = winOrOver(m); let home = 0, over = 0; m.forEach((r, i) => r.forEach((p, j) => { if (i > j) home += p; if (i + j >= 3) over += p; }));
    expect(w.home).toBeGreaterThanOrEqual(Math.max(home, over) - 1e-12); expect(w.home).toBeLessThanOrEqual(home + over + 1e-12);
  });
  it("scores halves from the half-time result; unscorable without it", () => {
    expect(marketHit("h1_under15", { h: 3, a: 1, hh: 1, ha: 0 })).toBe(true);
    expect(marketHit("h2_under25", { h: 3, a: 1, hh: 1, ha: 0 })).toBe(false); // 3 second-half goals
    expect(marketHit("h1_under25", { h: 2, a: 2 })).toBeNull();
    expect(marketHit("away_or_over25", { h: 2, a: 1 })).toBe(true);
    expect(marketHit("home_or_over25", { h: 0, a: 1 })).toBe(false);
  });
  const pred = (x: Record<string, number>) => ({ band: "MEDIUM", confidence: 60, calHome: 0.4, calDraw: 0.3, calAway: 0.3, calOver15: 0.6, calOver25: 0.4, calOver35: 0.2, calOver45: 0.08, calBtts: 0.45,
    calH1Under15: 0.7, calH1Under25: 0.9, calH2Under25: 0.86, calHomeOrOver25: 0.6, calAwayOrOver25: 0.55, ...x }) as never;
  it("headline never 1H / 2H Under 2.5; Top 20 allows only one of them", () => {
    const t = bestTip(pred({}), "H", "A")!;
    expect(["h1_under25", "h2_under25", "under45"]).not.toContain(t.key);
    expect(t.key).toBe("under35"); // strongest allowed market (U3.5 80%) — 1H U2.5 at 90% is skipped
    const items = Array.from({ length: 6 }, (_, i) => ({ item: i, id: String(i), startMs: i, tips: tipsFor(pred({ calH1Under15: 0.5 }), "H", "A") }));
    const top = selectTop(items);
    expect(top.filter((x) => x.tip.key === "h1_under25" || x.tip.key === "h2_under25")).toHaveLength(1);
  });
});

import { lineKey, parseLineKey } from "@/lib/markets";
import { issueToken, readToken } from "@/lib/access";
describe("per-fixture corner / shot lines", () => {
  const pred = (over: Record<number, number>) => ({ band: "MEDIUM", confidence: 60, calHome: 0.4, calDraw: 0.3, calAway: 0.3, calOver15: 0.6, calOver25: 0.4, calOver35: 0.2, calOver45: 0.08, calBtts: 0.45,
    cornersLine: 10.5, calCornersOver: over[10.5], cornerLines: Object.entries(over).map(([l, o]) => ({ l: Number(l), o })) }) as never;
  const rows = { 8.5: 0.78, 9.5: 0.66, 10.5: 0.52, 11.5: 0.38, 12.5: 0.26 };
  it("offers Over and Under on every line, flags main and strong", () => {
    const ms = allMarkets(pred(rows), "H", "A").filter((m) => m.group === "corners");
    expect(ms).toHaveLength(10);
    expect(ms.filter((m) => m.main)).toHaveLength(2);
    const strong = ms.filter((m) => m.strong);
    expect(strong).toHaveLength(1);
    expect(strong[0].key).toBe(lineKey("corners", "over", 9.5)); // most aggressive line still ≥ 65%
    expect(strong[0].p).toBeCloseTo(0.66);
  });
  it("keys carry the line and score against the match's corners", () => {
    expect(parseLineKey("corners_over@10.5")).toEqual({ base: "corners", side: "over", line: 10.5 });
    expect(marketHit("corners_over@10.5", { h: 1, a: 0, hc: 6, ac: 5 })).toBe(true);
    expect(marketHit("corners_under@10.5", { h: 1, a: 0, hc: 6, ac: 5 })).toBe(false);
    expect(marketHit("shots_over@24.5", { h: 1, a: 0 })).toBeNull();
  });
  it("alternative lines stay out of the Top 20 unless they are the strong line", () => {
    const tips = tipsFor(pred(rows), "H", "A", "corners");
    expect(tips.every((t) => t.main || t.strong)).toBe(true);
  });
});

describe("access code tokens", () => {
  it("accepts its own token, rejects expired, tampered or wrong-secret ones", async () => {
    const good = await issueToken("secret-a", 30);
    expect((await readToken(good, "secret-a")).valid).toBe(true);
    expect((await readToken(good, "secret-b")).valid).toBe(false);   // code changed ⇒ every device signed out
    expect((await readToken(`${good.slice(0, -1)}x`, "secret-a")).valid).toBe(false);
    expect((await readToken(await issueToken("secret-a", -1), "secret-a")).valid).toBe(false);
    expect((await readToken(undefined, "secret-a")).valid).toBe(false);
  });
});

describe("provider rate limits", () => {
  it("waits for the provider's window on 429 and then succeeds", async () => {
    const { fetchJson } = await import("@/lib/providers/http");
    const waits: number[] = [];
    const realTimeout = globalThis.setTimeout;
    // test double: run timers immediately but record the delay asked for
    globalThis.setTimeout = ((fn: () => void, ms: number) => { waits.push(ms); return realTimeout(fn, 0); }) as unknown as typeof setTimeout;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1
        ? new Response("rate limit", { status: 429, headers: { "Retry-After": "20" } })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const out = await fetchJson<{ ok: boolean }>("football-data", "https://example.test/x", {});
    globalThis.setTimeout = realTimeout;
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);
    expect(waits.some((w) => w >= 21_000)).toBe(true); // honoured Retry-After, not a 1-second retry
  });
});
