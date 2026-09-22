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
