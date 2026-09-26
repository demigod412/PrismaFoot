import { describe, expect, it } from "vitest";
import { marketTrust, trustFor, TRUST_CEIL, TRUST_FLOOR, TRUST_MIN_N, TRUST_SHRINK } from "@/lib/trust";
import type { MarketKey } from "@/lib/markets";

const row = (key: string, n: number, hit: number, avgP: number) => ({ key: key as MarketKey, n, hit, avgP });

describe("market trust from the settled ledger", () => {
  it("marks down a market that under-delivers and rewards one that keeps its promise", () => {
    // Corners Over: claimed 78%, landed 71% -> running at 0.91 before shrinkage.
    const t = marketTrust([row("corners_over", 400, 0.71, 0.78), row("dc_1x", 400, 0.84, 0.83)]);
    expect(t.corners_over!).toBeLessThan(1);
    expect(t.dc_1x!).toBeGreaterThan(1);
    // 400 calls is a real record, so most of the raw ratio survives.
    expect(t.corners_over!).toBeCloseTo(1 + (0.71 / 0.78 - 1) * (400 / 460), 3);
  });

  it("ignores a market with too little history rather than chasing noise", () => {
    expect(marketTrust([row("btts_yes", TRUST_MIN_N - 1, 0.4, 0.8)]).btts_yes).toBeUndefined();
    expect(marketTrust([row("btts_yes", TRUST_MIN_N, 0.4, 0.8)]).btts_yes).toBeDefined();
  });

  it("shrinks harder the smaller the sample", () => {
    const small = marketTrust([row("over25", 30, 0.5, 0.75)]).over25!;
    const large = marketTrust([row("over25", 2000, 0.5, 0.75)]).over25!;
    // Same terrible ratio; the thin sample is pulled much closer to neutral.
    expect(small).toBeGreaterThan(large);
    expect(Math.abs(1 - small)).toBeLessThan(Math.abs(1 - large));
  });

  it("gives a market with exactly TRUST_SHRINK calls half weight", () => {
    const t = marketTrust([row("under25", TRUST_SHRINK, 0.6, 0.8)]).under25!;
    expect(t).toBeCloseTo(1 + (0.75 - 1) * 0.5, 4);
  });

  it("clamps: a market can be marked down hard but never promoted much", () => {
    expect(marketTrust([row("draw", 5000, 0.2, 0.9)]).draw).toBe(TRUST_FLOOR);
    expect(marketTrust([row("home", 5000, 0.95, 0.6)]).home).toBe(TRUST_CEIL);
  });

  it("treats a missing or out-of-range entry as neutral", () => {
    expect(trustFor({}, "over25")).toBe(1);
    expect(trustFor({ over25: 0.9 } as never, "over25")).toBe(0.9);
    // A hand-edited or stale setting cannot skew the builder.
    expect(trustFor({ over25: 99 } as never, "over25")).toBe(1);
    expect(trustFor({ over25: -1 } as never, "over25")).toBe(1);
    expect(trustFor({ over25: "x" } as never, "over25")).toBe(1);
  });

  it("ignores a zero average probability instead of dividing by it", () => {
    expect(marketTrust([row("over25", 500, 0.5, 0)]).over25).toBeUndefined();
  });
});
