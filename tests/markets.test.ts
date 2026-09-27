import { describe, expect, it } from "vitest";
import type { Prediction } from "@prisma/client";
import {
  allMarkets, GROUP_LABEL, lineKey, MARKET_OPTIONS, parseSelector, selectorMatches, selectorLabel,
  type MarketGroup,
} from "@/lib/markets";
import { tipsFor, MIN_P } from "@/lib/top";
import { apiFootballKey, quoteFor } from "@/lib/odds";
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
