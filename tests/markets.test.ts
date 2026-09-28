import { describe, expect, it } from "vitest";
import type { Prediction } from "@prisma/client";
import {
  allMarkets, GROUP_LABEL, lineKey, MARKET_OPTIONS, parseSelector, selectorMatches, selectorLabel,
  type MarketGroup,
} from "@/lib/markets";
import { tipsFor, MIN_P } from "@/lib/top";
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

  it("still applies the probability floor inside a single market", () => {
    expect(tipsFor(pred({ calOver25: 0.4 } as Partial<Prediction>), "Home", "Away", "k:over25")).toEqual([]);
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
