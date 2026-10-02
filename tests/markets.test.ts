import { describe, expect, it } from "vitest";
import type { Prediction } from "@prisma/client";
import {
  allMarkets, GROUP_LABEL, lineKey, MARKET_OPTIONS, parseSelector, selectorMatches, selectorLabel,
  type MarketGroup,
} from "@/lib/markets";
import { tipsFor, MIN_P, MIN_P_NAMED } from "@/lib/top";
import { marketHit } from "@/lib/markets";
import { apiFootballKey, quoteFor } from "@/lib/odds";
import { noRunShare, noThreeInARow, noWinByTwo, notBothHalvesOver15, scoreMatrix, winByAtLeast } from "@/lib/model/dixonColes";
import { valueTips } from "@/lib/value";

/** A prediction with every optional market present, so the catalogue can be exercised whole. */
const pred = (over: Partial<Prediction> = {}) => ({
  calHome: 0.62, calDraw: 0.2, calAway: 0.18,
  calOver15: 0.82, calOver25: 0.61, calOver35: 0.36, calOver45: 0.18, calBtts: 0.58,
  calHomeBy2: 0.34, calAwayBy2: 0.08,
  calH1Under15: 0.62, calH1Under25: 0.85, calH2Under25: 0.8, calHtDraw: 0.4,
  calGg2: 0.14,
  calHomeOrOver25: 0.81, calAwayOrOver25: 0.66,
  cornersLine: 10.5, calCornersOver: 0.55,
  cornerLines: [{ l: 8.5, o: 0.78 }, { l: 10.5, o: 0.55 }, { l: 12.5, o: 0.3 }],
  shotsLine: 25.5, calShotsOver: 0.52,
  shotLines: [{ l: 23.5, o: 0.66 }, { l: 25.5, o: 0.52 }],
  band: "HIGH", confidence: 80,
  ...over,
}) as unknown as Prediction;

describe("every market in the project is selectable", () => {
  /*
   * The Top list only ever offered the nine GROUPS, so the commonest request there is — "the strongest
   * Over 2.5 tips" — could not be made at all: choosing "Goals O/U" returns whichever of six goals
   * markets is strongest per match, which is nearly always Under 4.5.
   */
  it("offers an option for every market the catalogue can produce", () => {
    const produced = new Set(allMarkets(pred(), "Home", "Away").map((m) => {
      const parts = /^(corners|shots)_(over|under)@/.exec(m.key);
      return parts ? `${parts[1]}_${parts[2]}` : m.key;
    }));
    const offered = new Set(MARKET_OPTIONS.map((o) => o.value.slice(2)));
    const missing = [...produced].filter((k) => !offered.has(k));
    expect(missing, `markets with no filter option: ${missing.join(", ")}`).toEqual([]);
  });

  it("puts every option in a real group", () => {
    for (const o of MARKET_OPTIONS) expect(Object.keys(GROUP_LABEL)).toContain(o.group);
  });

  it("accepts a group or a single market, and rejects anything else", () => {
    expect(parseSelector("goals")).toBe("goals");
    expect(parseSelector("k:over25")).toBe("k:over25");
    expect(parseSelector("k:nonsense")).toBeUndefined();
    expect(parseSelector(undefined)).toBeUndefined();
  });

  it("matches a line selector at any line, since lines are per fixture", () => {
    const m = { key: lineKey("corners", "over", 10.5), group: "corners" as MarketGroup };
    expect(selectorMatches("k:corners_over", m)).toBe(true);
    expect(selectorMatches("k:corners_under", m)).toBe(false);
    expect(selectorMatches("corners", m)).toBe(true);
    expect(selectorMatches("k:shots_over", m)).toBe(false);
    // The legacy fixed key is named by the same selector.
    expect(selectorMatches("k:corners_over", { key: "corners_over", group: "corners" })).toBe(true);
  });

  it("names the selection in words", () => {
    expect(selectorLabel(undefined)).toBe("All markets");
    expect(selectorLabel("goals")).toBe("Goals O/U");
    expect(selectorLabel("k:over25")).toBe("Over 2.5 goals");
  });
});

describe("filtering the top list by one market", () => {
  it("returns only that market", () => {
    const tips = tipsFor(pred(), "Home", "Away", "k:over25");
    expect(tips).toHaveLength(1);
    expect(tips[0].key).toBe("over25");
  });

  it("returns whichever is strongest when a group is chosen", () => {
    // Precisely why market-level filtering was needed: asking for the goals group hands back Under 4.5,
    // which is the strongest goals market on almost every fixture, not the one anyone had in mind.
    const tips = tipsFor(pred(), "Home", "Away", "goals");
    expect(tips[0].key).toBe("under45");
    expect(tips.map((t) => t.key)).toContain("over25");
  });

  it("honours an explicit ask for a market the mixed list excludes", () => {
    // Draws are kept out of the mixed list because they would never be anyone's strongest tip. An
    // option that is always empty would be worse than no option, so asking by name overrides it.
    const p = pred({ calDraw: 0.6 } as Partial<Prediction>);
    expect(tipsFor(p, "Home", "Away").some((t) => t.key === "draw")).toBe(false);
    expect(tipsFor(p, "Home", "Away", "k:draw").map((t) => t.key)).toEqual(["draw"]);
  });

  it("shows every corner line when corners are asked for, and one when they are not", () => {
    // Alternative lines are suppressed so one fixture cannot contribute eight near-identical tips —
    // but the whole point of selecting corners is to see the lines.
    // Four lines, three of them over the probability floor on the over side.
    const laddered = pred({
      cornerLines: [{ l: 6.5, o: 0.9 }, { l: 8.5, o: 0.78 }, { l: 10.5, o: 0.55 }, { l: 12.5, o: 0.3 }],
    } as unknown as Partial<Prediction>);
    const asked = tipsFor(laddered, "Home", "Away", "k:corners_over");
    expect(asked).toHaveLength(3);
    expect(asked.every((t) => t.group === "corners" && t.p >= MIN_P)).toBe(true);
    // In the mixed list only the main line and the one "strong" line survive, so a fixture cannot
    // contribute a wall of near-identical corner tips.
    const mixed = tipsFor(laddered, "Home", "Away").filter((t) => t.group === "corners");
    expect(mixed.length).toBeLessThan(asked.length);
    expect(mixed.every((t) => t.main || t.strong)).toBe(true);
  });

  /*
   * This used to assert the opposite: that MIN_P applied inside a named market too, so a 40% Over 2.5
   * returned nothing. The reasoning was that a filter showing a weak call becomes a recommendation.
   *
   * In use it failed the other way round. Filtering the Top 50 to Over 3.5, the draw, win-by-2 or GG2+ —
   * all markets the model prices perfectly well, none of which reaches 0.55 often or at all — returned an
   * empty page, which reads as broken rather than selective. Naming a market means "rank fixtures by this
   * market", and a ranking is only useful if it has entries. Every row shows its probability, so a 40%
   * leader describes itself.
   */
  it("ranks a named market below MIN_P, but keeps MIN_P for the mixed list and for a group", () => {
    const weak = pred({ calOver25: 0.4 } as Partial<Prediction>);
    const named = tipsFor(weak, "Home", "Away", "k:over25");
    expect(named.map((t) => t.key)).toEqual(["over25"]);
    expect(named[0].p).toBeCloseTo(0.4, 12);
    // The mixed list is unchanged: 0.4 is still below MIN_P and still excluded there.
    expect(tipsFor(weak, "Home", "Away").some((t) => t.key === "over25")).toBe(false);
    // So is a group selector — "Goals O/U" is a browse, not a request for one market.
    expect(tipsFor(weak, "Home", "Away", "goals").some((t) => t.key === "over25")).toBe(false);
    // And a named market below even the relaxed floor is still dropped.
    expect(tipsFor(pred({ calOver25: MIN_P_NAMED / 2 } as Partial<Prediction>), "Home", "Away", "k:over25")).toEqual([]);
  });
});

describe("corner odds could never match a corner tip", () => {
  /*
   * The bug: the model moved to a per-fixture ladder whose keys carry the line, while the odds parser
   * still filed corner prices under the legacy fixed key. A quote under `corners_over` could never be
   * found for a tip on `corners_over@10.5`, so corners silently never appeared in the value list at
   * all — not an empty market, an unmatchable one.
   */
  it("carries the line in the quote key, at whatever line the book prices", () => {
    expect(apiFootballKey("Corners Over Under", "Over 8.5")).toBe("corners_over@8.5");
    expect(apiFootballKey("Corners Over Under", "Under 10.5")).toBe("corners_under@10.5");
    expect(apiFootballKey("Total Corners", "Over 9.5")).toBe("corners_over@9.5");
    expect(apiFootballKey("Corners Over Under", "nonsense")).toBeNull();
  });

  it("finds a corner price for a tip on the same line", () => {
    const tips = valueTips(pred(), { "corners_over@10.5": { odds: 2.1, best: 2.2, books: 6 } }, "Home", "Away");
    expect(tips.map((t) => t.key)).toContain("corners_over@10.5");
  });

  it("does not use a price from a different line", () => {
    // Comparing a 8.5 price to a 10.5 tip would be pricing the wrong market.
    const tips = valueTips(pred(), { "corners_over@8.5": { odds: 2.1, best: 2.2, books: 6 } }, "Home", "Away");
    expect(tips.some((t) => t.key === "corners_over@10.5")).toBe(false);
  });

  it("reads a legacy corner quote back for the 8.5 line only", () => {
    const legacy = { corners_over: { odds: 1.9, best: 2, books: 5 } } as const;
    expect(quoteFor(legacy, "corners_over@8.5")?.odds).toBe(1.9);
    expect(quoteFor(legacy, "corners_over@10.5")).toBeUndefined();
  });

  it("leaves shots unpriced rather than inventing a mapping", () => {
    // API-Football does not offer total shots prematch. Model probability, no price.
    expect(apiFootballKey("Total Shots", "Over 25.5")).toBeNull();
    const tips = valueTips(pred(), { "shots_over@25.5": { odds: 2, best: 2, books: 3 } }, "Home", "Away");
    // The quote can be honoured if one ever arrives; what is absent is the parser mapping, not the path.
    expect(tips.some((t) => t.key === "shots_over@25.5")).toBe(true);
  });
});

describe("the three shape markets", () => {
  const shaped = (over: Partial<Prediction> = {}) =>
    pred({ calNoRun3: 0.81, calNoBothHalvesOver15: 0.85, calNoWinBy2: 0.66, ...over } as Partial<Prediction>);

  it("appears in the catalogue, with the run market flagged unverifiable", () => {
    const ms = allMarkets(shaped(), "Home", "Away");
    const byKey = new Map(ms.map((m) => [m.key, m]));
    expect(byKey.get("no_both_halves_over15")?.group).toBe("halves");
    expect(byKey.get("no_win_by2")?.group).toBe("hcp");
    expect(byKey.get("no_run3")?.group).toBe("shape");
    expect(byKey.get("no_run3")?.unverifiable).toBe(true);
    // Only that one. Flagging anything else would quietly drop a scoreable market from the record.
    expect(ms.filter((m) => m.unverifiable).map((m) => m.key)).toEqual(["no_run3"]);
  });

  it("scores the two that can be settled from a stored result", () => {
    // 2-1 with a 1-0 half-time: margin of one, and the second half had 2 goals but the first had 1.
    const r = { h: 2, a: 1, hh: 1, ha: 0 };
    expect(marketHit("no_win_by2", r)).toBe(true);
    expect(marketHit("no_both_halves_over15", r)).toBe(true);
    // 3-0 at 0-0 half-time: won by 3, and only the second half went over 1.5.
    expect(marketHit("no_win_by2", { h: 3, a: 0, hh: 0, ha: 0 })).toBe(false);
    // 2-2 from 1-1: both halves produced two goals, so this one fails.
    expect(marketHit("no_both_halves_over15", { h: 2, a: 2, hh: 1, ha: 1 })).toBe(false);
  });

  it("cannot score the half market without a half-time score", () => {
    expect(marketHit("no_both_halves_over15", { h: 4, a: 0 })).toBeNull();
  });

  it("never scores the run market, whatever the result", () => {
    // The order the goals arrived in is not stored, so there is no result that could settle it.
    expect(marketHit("no_run3", { h: 3, a: 0, hh: 2, ha: 0 })).toBeNull();
    expect(marketHit("no_run3", { h: 0, a: 0, hh: 0, ha: 0 })).toBeNull();
  });

  it("keeps the unscoreable market out of every ranked list", () => {
    /*
     * The point of the exclusion: a tip that can never be scored would sit in the Top 50's track record
     * as a permanent blank, and the accuracy ledger counts what it can score. Leaving it in would
     * quietly dilute the one number in this app that has to mean something.
     */
    expect(tipsFor(shaped(), "Home", "Away").some((t) => t.key === "no_run3")).toBe(false);
    // Not even when asked for by name, unlike the draw.
    expect(tipsFor(shaped(), "Home", "Away", "k:no_run3")).toEqual([]);
    expect(tipsFor(shaped(), "Home", "Away", "shape")).toEqual([]);
  });

  it("still ranks the two scoreable ones", () => {
    expect(tipsFor(shaped(), "Home", "Away", "k:no_win_by2").map((t) => t.key)).toEqual(["no_win_by2"]);
    expect(tipsFor(shaped(), "Home", "Away", "k:no_both_halves_over15").map((t) => t.key)).toEqual(["no_both_halves_over15"]);
  });

  it("offers the two scoreable ones as Top 50 filters, and not the third", () => {
    const offered = MARKET_OPTIONS.map((o) => o.value);
    expect(offered).toContain("k:no_win_by2");
    expect(offered).toContain("k:no_both_halves_over15");
    expect(offered).not.toContain("k:no_run3");
  });

  it("leaves them out entirely when the model did not produce them", () => {
    const ms = allMarkets(pred({ calNoRun3: null, calNoBothHalvesOver15: null, calNoWinBy2: null } as unknown as Partial<Prediction>), "Home", "Away");
    expect(ms.some((m) => m.group === "shape")).toBe(false);
    expect(ms.some((m) => m.key === "no_win_by2")).toBe(false);
  });
});

describe("the shape markets are exact, not approximated", () => {
  const m = scoreMatrix(1.5, 1.2, 0);

  it("agrees with brute-force enumeration of goal orderings", () => {
    // Verified in full against enumeration for every score up to 8-8; these are the spot checks.
    expect(noRunShare(3, 0)).toBe(0);            // HHH is the only arrangement
    expect(noRunShare(2, 2)).toBe(1);            // no arrangement of 2 and 2 can make a run of 3
    expect(noRunShare(3, 1)).toBeCloseTo(0.5, 12);
    expect(noRunShare(4, 1)).toBeCloseTo(0.2, 12); // only HHAHH survives
    expect(noRunShare(0, 0)).toBe(1);
  });

  it("matches the independently computed figure for known rates", () => {
    expect(noThreeInARow(m)).toBeCloseTo(0.808, 3);
    expect(noThreeInARow(scoreMatrix(3.0, 0.5, 0))).toBeCloseTo(0.487, 3);
  });

  it("is the exact complement of winning by two or more", () => {
    const by2 = winByAtLeast(m, 2);
    expect(noWinByTwo(m)).toBeCloseTo(1 - (by2.home + by2.away), 12);
  });

  it("cannot have both halves over 1.5 under four goals", () => {
    // It takes two in each half, so any total below four satisfies the market by construction.
    const low = scoreMatrix(0.25, 0.2, 0);
    expect(notBothHalvesOver15(low, 0.45)).toBeGreaterThan(0.99);
    // And a high-scoring game is where it becomes a real question.
    expect(notBothHalvesOver15(scoreMatrix(2.5, 2.0, 0), 0.45)).toBeLessThan(0.7);
  });

  it("returns a probability for every market, on any rates", () => {
    for (const [lh, la] of [[0.1, 0.1], [4, 3], [1, 1]] as [number, number][]) {
      const mm = scoreMatrix(lh, la, 0);
      for (const v of [noThreeInARow(mm), noWinByTwo(mm), notBothHalvesOver15(mm, 0.45)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

import { bothTeamsAtLeast } from "@/lib/model/dixonColes";
import { MIN_P_NAMED } from "@/lib/top";

describe("GG2+ (both teams to score two or more)", () => {
  it("equals the summed region of the matrix, and BTTS at k = 1", () => {
    const m = scoreMatrix(1.7, 1.4, -0.05);
    let region = 0, btts = 0;
    m.forEach((row, i) => row.forEach((q, j) => { if (i >= 2 && j >= 2) region += q; if (i >= 1 && j >= 1) btts += q; }));
    expect(bothTeamsAtLeast(m, 2)).toBeCloseTo(region, 12);
    // k = 1 IS both teams to score, which is the market the model already prices.
    expect(bothTeamsAtLeast(m, 1)).toBeCloseTo(btts, 12);
  });

  /*
   * The Dixon-Coles correction only adjusts 0-0, 1-0, 0-1 and 1-1, so it is inactive across the whole
   * region where both sides reach two: there the joint is the product of two independent Poisson tails.
   * Asserted because the implementation sums the grid instead, and a claim that the two agree is worth
   * holding to rather than repeating.
   */
  it("agrees with the product of the two tails at k = 2, where rho does not reach", () => {
    for (const [lh, la] of [[0.8, 0.7], [1.45, 1.15], [2.4, 2.0], [2.6, 0.6]] as const) {
      const m = scoreMatrix(lh, la, -0.05);
      let ph = 0, pa = 0;
      m.forEach((row, i) => row.forEach((q, j) => { if (i >= 2) ph += q; if (j >= 2) pa += q; }));
      expect(bothTeamsAtLeast(m, 2)).toBeCloseTo(ph * pa, 3);
    }
  });

  it("rises with expected goals and stays a long shot even when it is open", () => {
    const at = (lh: number, la: number) => bothTeamsAtLeast(scoreMatrix(lh, la, -0.05), 2);
    expect(at(0.8, 0.7)).toBeLessThan(at(1.45, 1.15));
    expect(at(1.45, 1.15)).toBeLessThan(at(2.4, 2.0));
    // A mismatch is a poor GG2+ fixture however many goals it promises: one side has to reach two as well.
    expect(at(2.6, 0.6)).toBeLessThan(at(1.7, 1.4));
    // Never near a coin flip, which is why it is excluded from the mixed Top 50 and floored low.
    expect(at(2.4, 2.0)).toBeLessThan(0.5);
  });

  it("settles from the final score alone", () => {
    expect(marketHit("gg2", { h: 2, a: 2 })).toBe(true);
    expect(marketHit("gg2", { h: 3, a: 2 })).toBe(true);
    expect(marketHit("gg2", { h: 2, a: 1 })).toBe(false);
    expect(marketHit("gg2", { h: 5, a: 0 })).toBe(false);
    expect(marketHit("gg2", { h: 0, a: 0 })).toBe(false);
  });

  it("is offered in the catalogue but kept off the match page and out of the builder", () => {
    const tip = allMarkets(pred(), "Home", "Away").find((m) => m.key === "gg2");
    expect(tip).toBeDefined();
    // The match page and the builder both filter on this flag.
    expect(tip!.scannerOnly).toBe(true);
    expect(tip!.unverifiable).toBeUndefined();
    expect(MARKET_OPTIONS.some((o) => o.value === "k:gg2")).toBe(true);
  });

  it("never enters the mixed Top 50, but is ranked when it is asked for by name", () => {
    // 0.14 is a realistic GG2+ figure and far below MIN_P, so the mixed list excludes it twice over.
    const p = pred({ calGg2: 0.14 } as never);
    expect(tipsFor(p, "H", "A").some((t) => t.key === "gg2")).toBe(false);
    const named = tipsFor(p, "H", "A", "k:gg2");
    expect(named.map((t) => t.key)).toEqual(["gg2"]);
    expect(named[0].p).toBeCloseTo(0.14, 12);
    // Its own group must not smuggle it in: the group list is still held to MIN_P.
    expect(tipsFor(p, "H", "A", "btts").some((t) => t.key === "gg2")).toBe(false);
    // And a named market below even the relaxed floor is still dropped.
    expect(tipsFor(pred({ calGg2: MIN_P_NAMED / 2 } as never), "H", "A", "k:gg2")).toEqual([]);
  });
});
