import type { Prediction } from "@prisma/client";
import { allMarkets, marketHit, selectorKey, selectorMatches, type MarketKey, type MarketSelector, type MarketSource, type MarketTip, type MatchResult } from "./markets";

/*
 * Top tips: one tip per match (its single strongest market within the chosen group), ranked by strength.
 *   strength = calibrated p × (0.85 + 0.15 × confidence/100)
 * Left out: Low-confidence calls, tips under 55% and draws.
 * Caps in the mixed ("All markets") list, so high-probability markets can't take over:
 *   max 5 double chance · max 5 Under 4.5 · max 5 win-by-2 handicap · max 2 half Under 2.5 (1st or 2nd half)
 * Caps scale with the list length: they were 2/2/2/1 when it held 20 tips.
 * When a match's strongest tip is blocked by a cap, its next-strongest market is used instead.
 */
export const TOP_N = 50;
export const MIN_P = 0.55;
export const WINDOWS = [1, 2, 3, 4, 5, 6, 7] as const;
/*
 * Out of every ranked list.
 *
 * "draw" because it would never be anyone's strongest tip; "no_run3" because it cannot be settled, and a
 * tip list whose entries can never be scored would quietly poison the track record underneath it — the
 * one number in this app that has to mean something.
 */
const EXCLUDED: MarketKey[] = ["draw", "no_run3"];

/** Max tips per capped category in the mixed list. */
export const CAPS = { dc: 5, under45: 5, hcp: 5, halfU25: 2 } as const;
type CapKey = keyof typeof CAPS;
const capOf = (t: MarketTip): CapKey | null => (t.group === "dc" ? "dc" : t.key === "under45" ? "under45" : t.group === "hcp" ? "hcp" : t.key === "h1_under25" || t.key === "h2_under25" ? "halfU25" : null);

export interface Tip extends MarketTip { strength: number }
export type TipMarket = MarketKey;

export const strengthOf = (prob: number, confidence: number) => prob * (0.85 + 0.15 * (confidence / 100));

/**
 * All qualifying tips for one match, strongest first.
 *
 * `sel` names a group or a single market. Two things it changes beyond narrowing:
 *
 *   - Asking for a market by name overrides the standing exclusion. Draws are kept out of the mixed list
 *     because they would never be anyone's strongest tip, but someone who selects "Draw" is not asking
 *     for the mixed list — and an option that is always empty is worse than no option.
 *   - Alternative corner and shot lines are normally suppressed so one fixture cannot contribute eight
 *     near-identical tips. Asking for that base and side explicitly lifts that too, since the whole
 *     point of choosing it is to see the lines.
 */
export function tipsFor(p: MarketSource, home: string, away: string, sel?: MarketSelector): Tip[] {
  if (p.band === "LOW") return [];
  const named = selectorKey(sel);
  // An explicit ask overrides the exclusion — except for the unscoreable one, which has no business in
  // a ranked list however deliberately it is requested.
  const asksForLines = named === "corners_over" || named === "corners_under" || named === "shots_over" || named === "shots_under";
  return allMarkets(p, home, away)
    .filter((m) => (!EXCLUDED.includes(m.key) || (named === m.key && !m.unverifiable))
      && (!m.alt || m.strong || asksForLines)
      && selectorMatches(sel, m) && m.p >= MIN_P)
    .map((m) => ({ ...m, strength: strengthOf(m.p, p.confidence) }))
    .sort((a, b) => b.strength - a.strength);
}

/**
 * Strongest single tip for one match (match page headline and board rows).
 * Double chance, Under 4.5, 1st-half Under 2.5 and 2nd-half Under 2.5 are never the headline pick: they would head almost every match.
 * They stay visible in the match's "All markets" card and (capped) in the Top 50.
 */
export const HEADLINE_EXCLUDED = (t: MarketTip) => t.group === "dc" || t.key === "under45" || t.key === "h1_under25" || t.key === "h2_under25";
export function bestTip(p: MarketSource, home: string, away: string, sel?: MarketSelector): Tip | null {
  return tipsFor(p, home, away, sel).find((t) => sel || !HEADLINE_EXCLUDED(t)) ?? null;
}

/**
 * Build the Top N: one tip per match, strongest first, with category caps in the mixed list.
 * Items carry whatever the caller needs back (fixture etc.).
 */
export function selectTop<T>(items: { item: T; id: string; tips: Tip[]; startMs: number }[], sel?: MarketSelector, n = TOP_N): { item: T; tip: Tip }[] {
  const pairs = items.flatMap((x) => x.tips.map((tip) => ({ x, tip })))
    .sort((a, b) => b.tip.strength - a.tip.strength || a.x.startMs - b.x.startMs);
  const used = new Set<string>(), count: Record<CapKey, number> = { dc: 0, under45: 0, hcp: 0, halfU25: 0 };
  const out: { item: T; tip: Tip }[] = [];
  for (const { x, tip } of pairs) {
    if (out.length >= n) break;
    if (used.has(x.id)) continue;
    const c = sel ? null : capOf(tip); // caps only apply to the mixed list
    if (c && count[c] >= CAPS[c]) continue;
    used.add(x.id); if (c) count[c]++;
    out.push({ item: x.item, tip });
  }
  return out;
}

/** Back-compat helper for goals-only callers. */
export function tipHit(t: MarketKey, h: number, a: number, extra: Partial<MatchResult> = {}, lines: { corners?: number | null; shots?: number | null } = {}) {
  return marketHit(t, { h, a, ...extra }, lines);
}
