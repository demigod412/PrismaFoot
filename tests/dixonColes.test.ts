import { describe, expect, it } from "vitest";
import { marketsFromMatrix, scoreMatrix, tau, topScorelines, unders } from "@/lib/model/dixonColes";
import { fitLeague, type HistMatch } from "@/lib/model/ratings";
import { fitBinary, apply } from "@/lib/model/calibration";
import { predictFixture } from "@/lib/model/predict";
import { makeRng, poissonSample } from "@/lib/demo/rng";

describe("Dixon–Coles matrix", () => {
  it("sums to 1 and 1X2 sums to 1", () => {
    const m = scoreMatrix(1.6, 1.1, -0.1);
    const total = m.flat().reduce((s, p) => s + p, 0);
    expect(total).toBeCloseTo(1, 10);
    const k = marketsFromMatrix(m);
    expect(k.home + k.draw + k.away).toBeCloseTo(1, 10);
    expect(k.over15).toBeGreaterThan(k.over25);
    expect(k.over25).toBeGreaterThan(k.over35);
    expect(k.over35).toBeGreaterThan(k.over45);
    const u = unders(k);
    expect(u.under25 + k.over25).toBeCloseTo(1, 12);
    expect(u.under45).toBeGreaterThan(u.under35);
    expect(u.under35).toBeGreaterThan(u.under25);
    // U2.5 equals the sum of cells with total goals ≤ 2
    const lo = m.reduce((s, row, i) => s + row.reduce((t, p, j) => t + (i + j <= 2 ? p : 0), 0), 0);
    expect(u.under25).toBeCloseTo(lo, 12);
  });
  it("negative rho raises 0-0 and 1-1 vs independent Poisson", () => {
    const ind = scoreMatrix(1.3, 1.1, 0), dc = scoreMatrix(1.3, 1.1, -0.12);
    expect(dc[0][0]).toBeGreaterThan(ind[0][0]);
    expect(dc[1][1]).toBeGreaterThan(ind[1][1]);
    expect(dc[1][0]).toBeLessThan(ind[1][0]);
  });
  it("tau is 1 outside the four low-score cells", () => {
    expect(tau(2, 1, 1.5, 1.2, -0.1)).toBe(1);
  });
  it("top scorelines are sorted and most-likely first", () => {
    const top = topScorelines(scoreMatrix(2.2, 0.7, -0.08));
    expect(top).toHaveLength(5);
    expect(top[0].p).toBeGreaterThanOrEqual(top[1].p);
  });
});

describe("ratings", () => {
  it("recovers strength ordering and home advantage from simulated goals", () => {
    const rng = makeRng(7);
    const truth = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, a: 0.7 + i * 0.07, d: 1.3 - i * 0.05 }));
    const ms: HistMatch[] = [];
    const start = new Date("2026-01-01").getTime();
    let day = 0;
    for (let r = 0; r < 3; r++) for (const h of truth) for (const a of truth) if (h !== a) {
      ms.push({ homeId: h.id, awayId: a.id, date: new Date(start + (day++ % 200) * 864e5),
        homeGoals: poissonSample(rng, 1.2 * h.a * a.d * 1.25), awayGoals: poissonSample(rng, 1.2 * a.a * h.d) });
    }
    const fit = fitLeague(ms, new Date("2026-08-01"));
    expect(fit.homeAdv).toBeGreaterThan(1.1);
    expect(fit.homeAdv).toBeLessThan(1.45);
    expect(fit.teams.get("t11")!.attack).toBeGreaterThan(fit.teams.get("t0")!.attack);
    expect(fit.teams.get("t11")!.defence).toBeLessThan(fit.teams.get("t0")!.defence);
  });
});

describe("calibration", () => {
  it("identity below 50 settled", () => {
    const c = fitBinary([0.6, 0.7], [1, 0]);
    expect(c.method).toBe("identity");
    expect(apply(c, 0.63)).toBeCloseTo(0.63);
  });
  it("is monotone and pulls over-confident probs down", () => {
    const rng = makeRng(3);
    const raw: number[] = [], y: (0 | 1)[] = [];
    for (let i = 0; i < 400; i++) { const p = rng(); raw.push(p); y.push(rng() < 0.5 + (p - 0.5) * 0.6 ? 1 : 0); }
    const c = fitBinary(raw, y);
    expect(c.method).toBe("isotonic");
    expect(apply(c, 0.95)).toBeLessThan(0.95);
    for (let i = 1; i < c.knots.length; i++) expect(c.knots[i][1]).toBeGreaterThanOrEqual(c.knots[i - 1][1]);
  });
});

describe("predictFixture", () => {
  it("flags missing news and never shows ≥90% on Low", () => {
    const fit = fitLeague([], new Date());
    const out = predictFixture({ fit, homeId: "x", awayId: "y", homeName: "X", awayName: "Y", kickoff: new Date(),
      restHomeDays: null, restAwayDays: null, newsHome: null, newsAway: null, formHome: "", formAway: "" });
    expect(out.dataFlags).toContain("missing_news");
    expect(out.band).not.toBe("HIGH");
    expect(out.rationale).toHaveLength(4);
    expect(out.cal.home + out.cal.draw + out.cal.away).toBeCloseTo(1, 6);
    if (out.band === "LOW") {
      Object.values(out.cal).forEach((p) => expect(p).toBeLessThan(0.9));
      Object.values(unders(out.cal)).forEach((p) => expect(p).toBeLessThan(0.9));
    }
  });
});

import { bestTip, tipHit } from "@/lib/top";
describe("top tips", () => {
  const base = { band: "HIGH", confidence: 80, calHome: 0.62, calDraw: 0.22, calAway: 0.16, calOver15: 0.78, calOver25: 0.52, calOver35: 0.28, calOver45: 0.12, calBtts: 0.5 } as never;
  it("picks the single strongest qualifying market and skips Low", () => {
    const t = bestTip(base, "H", "A")!;
    expect(t.market).toBe("over15"); expect(t.p).toBeCloseTo(0.78);
    expect(bestTip({ ...(base as object), band: "LOW" } as never, "H", "A")).toBeNull();
  });
  it("scores results", () => {
    expect(tipHit("under35", 2, 1)).toBe(true); expect(tipHit("btts_no", 2, 0)).toBe(true); expect(tipHit("away", 1, 1)).toBe(false);
  });
});
