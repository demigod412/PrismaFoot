import type { Prediction } from "@prisma/client";

/*
 * Top tips: one tip per match (its single strongest market), ranked by a strength score.
 *   strength = calibrated p × (0.85 + 0.15 × confidence/100)
 * Probability does almost all the work; confidence breaks near-ties in favour of better-supported calls.
 * Low-confidence calls, draws and Under 4.5 (true in ~90% of games, so it would crowd out everything) are left out.
 */
export type TipMarket = "home" | "away" | "over15" | "over25" | "under25" | "under35" | "btts_yes" | "btts_no";
export interface Tip { market: TipMarket; label: string; p: number; strength: number }

export const TOP_N = 20;
export const MIN_P = 0.55;
export const WINDOWS = [1, 2, 3, 4, 5, 6, 7] as const;

export function candidates(p: Prediction, home: string, away: string): Omit<Tip, "strength">[] {
  return [
    { market: "home", label: `${home} to win`, p: p.calHome },
    { market: "away", label: `${away} to win`, p: p.calAway },
    { market: "over15", label: "Over 1.5 goals", p: p.calOver15 },
    { market: "over25", label: "Over 2.5 goals", p: p.calOver25 },
    { market: "under25", label: "Under 2.5 goals", p: 1 - p.calOver25 },
    { market: "under35", label: "Under 3.5 goals", p: 1 - p.calOver35 },
    { market: "btts_yes", label: "Both teams to score", p: p.calBtts },
    { market: "btts_no", label: "Both teams to score: No", p: 1 - p.calBtts },
  ];
}

export const strengthOf = (prob: number, confidence: number) => prob * (0.85 + 0.15 * (confidence / 100));

/** The single strongest tip for a match, or null if it doesn't qualify. */
export function bestTip(p: Prediction, home: string, away: string): Tip | null {
  if (p.band === "LOW") return null;
  const best = candidates(p, home, away).sort((a, b) => b.p - a.p)[0];
  if (!best || best.p < MIN_P) return null;
  return { ...best, strength: strengthOf(best.p, p.confidence) };
}

export function tipHit(t: TipMarket, h: number, a: number): boolean {
  switch (t) {
    case "home": return h > a; case "away": return a > h;
    case "over15": return h + a >= 2; case "over25": return h + a >= 3;
    case "under25": return h + a <= 2; case "under35": return h + a <= 3;
    case "btts_yes": return h > 0 && a > 0; case "btts_no": return h === 0 || a === 0;
  }
}
