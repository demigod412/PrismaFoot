import { describe, expect, it } from "vitest";
import { BANKERS, bankerView, legState, pickBanker, pickGameOfDay, rolloverChains, slipState, streaks, type StoredLeg } from "@/lib/banker";
import type { Candidate } from "@/lib/builder";

const cand = (match: string, market: string, p: number, odds: number, o: Partial<Candidate> = {}): Candidate =>
  ({ matchId: match, league: `L${match}`, startMs: 0, match, label: market, market, group: market.split("_")[0], p, odds, real: true, band: "HIGH", ...o });

/** A day of 30 fixtures each offering a few short-priced markets. */
const day = () => Array.from({ length: 30 }, (_, i) => [
  cand(`m${i}`, "under45", 0.93 - (i % 5) * 0.005, 1.08 + (i % 4) * 0.01),
  cand(`m${i}`, "over15", 0.9 - (i % 3) * 0.01, 1.12 + (i % 3) * 0.01),
  cand(`m${i}`, "dc_1x", 0.88, 1.15),
  cand(`m${i}`, "home_or_over25", 0.95, 1.05), // not bookable as one selection: never used
]).flat();

describe("daily banker", () => {
  it("reaches each target with at least the minimum number of legs, using bookable markets only", () => {
    for (const cfg of BANKERS) {
      const s = pickBanker(day(), cfg)!;
      expect(s, cfg.label).toBeTruthy();
      expect(s.legs.length).toBeGreaterThanOrEqual(cfg.minLegs);
      expect(s.odds).toBeGreaterThanOrEqual(cfg.target);
      expect(s.odds).toBeLessThan(cfg.target * 1.15);
      expect(s.legs.some((l) => l.market === "home_or_over25")).toBe(false);
      expect(new Set(s.legs.map((l) => l.matchId)).size).toBe(s.legs.length); // one leg per match
    }
  });
  it("returns nothing rather than a short slip when the day is too thin", () => {
    expect(pickBanker(day().slice(0, 12), BANKERS[1])).toBeNull(); // 3 fixtures cannot make 8 legs
  });
  it("never uses Low-confidence calls", () => {
    const s = pickBanker(day().map((c) => (c.matchId === "m0" ? { ...c, band: "LOW", p: 0.99 } : c)), BANKERS[0])!;
    expect(s.legs.some((l) => l.matchId === "m0")).toBe(false);
  });
  it("blends priced legs with the bookmaker and prices unpriced ones with a margin", () => {
    expect(bankerView(cand("a", "over15", 0.9, 1.25)).p).toBeCloseTo(0.5 * 0.9 + 0.5 / (1.25 * 1.05), 12);
    const fair = bankerView(cand("a", "over15", 0.8, 1.25, { real: false }));
    expect(fair.p).toBe(0.8);
    expect(fair.odds).toBeLessThan(1.25); // shorter than the fair 1/p: what a book would actually pay
  });
  it("picks the game of the day in the 1.20-1.60 band, High confidence first", () => {
    const g = pickGameOfDay([cand("a", "home", 0.75, 1.3, { band: "MEDIUM" }), cand("b", "over15", 0.7, 1.35), cand("c", "under45", 0.95, 1.05)]);
    expect(g?.matchId).toBe("b");
  });
});

describe("settling a stored banker", () => {
  const leg = (market: string, odds = 1.1): StoredLeg => ({ fixtureId: market, market, label: market, match: "", league: "", kickoff: "", p: 0.9, odds, real: true });
  const fx = (h: number, a: number, status = "FINISHED") => ({ status, homeGoals: h, awayGoals: a, htHome: null, htAway: null, hc: null, ac: null, hs: null, as: null });
  it("wins only when every live leg wins; void legs drop out of the price", () => {
    expect(legState(leg("over15"), fx(2, 1))).toBe("won");
    expect(legState(leg("over15"), fx(0, 1))).toBe("lost");
    expect(legState(leg("over15"), fx(0, 0, "POSTPONED"))).toBe("void");
    expect(legState(leg("over15"), fx(0, 0, "SCHEDULED"))).toBe("pending");
    expect(slipState([{ odds: 1.2, state: "won" }, { odds: 1.5, state: "void" }])).toEqual({ state: "won", odds: 1.2 });
    expect(slipState([{ odds: 1.2, state: "won" }, { odds: 1.1, state: "pending" }]).state).toBe("pending");
    expect(slipState([{ odds: 1.2, state: "lost" }, { odds: 1.1, state: "pending" }]).state).toBe("lost");
  });
  it("counts rollover chains: N wins cash out, a loss busts, pending ends the series", () => {
    const d = (state: "won" | "lost" | "pending", i: number) => ({ day: `d${i}`, state, odds: 1.74 });
    const series = (["won", "won", "won", "won", "won", "lost", "won", "won", "pending"] as const).map((s, i) => d(s, i));
    const r = rolloverChains(series, 4);
    expect(r.completed).toBe(1);
    expect(r.busted).toBe(1);
    expect(r.chains[0].multiplier).toBeCloseTo(1.74 ** 4, 10);
    expect(r.open?.reached).toBe(2);
    expect(streaks(series)).toEqual({ best: 5, current: 2 });
  });
});
