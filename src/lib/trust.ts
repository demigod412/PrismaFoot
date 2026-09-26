import type { MarketKey } from "./markets";

/**
 * How much each market actually delivers, relative to what it claims.
 *
 * The ledger records, per market, the realised hit rate and the average probability the model put on
 * it. Their ratio is the market's reliability: corners Over landing 71% of the time on calls that
 * averaged 78% is running at 0.91, while double chance landing 84% against a claimed 83% is at 1.01.
 * The builder multiplies a leg's probability by this before ranking, so markets that keep their
 * promises are preferred over ones that merely look good on paper.
 *
 * Small samples are the danger: twelve settled calls tell you almost nothing, and acting on them
 * would chase noise. The ratio is therefore shrunk toward 1 by sample size and clamped, so a market
 * needs a real record before it moves the ranking, and can never dominate it.
 */
export const TRUST_SETTING = "marketTrust";

/** Below this many settled calls a market's record says too little to act on at all. */
export const TRUST_MIN_N = 25;
/** Sample size at which a market's record carries half the weight against the neutral 1. */
export const TRUST_SHRINK = 60;
/** A market can be marked down hard, but never promoted much: being lucky is not being good. */
export const TRUST_FLOOR = 0.75;
export const TRUST_CEIL = 1.08;

export type MarketTrust = Partial<Record<MarketKey, number>>;

export interface MarketRecord { key: MarketKey; n: number; hit: number; avgP: number }

export function marketTrust(rows: MarketRecord[]): MarketTrust {
  const out: MarketTrust = {};
  for (const r of rows) {
    if (r.n < TRUST_MIN_N || r.avgP <= 0) continue; // no record worth acting on
    const ratio = r.hit / r.avgP;
    const shrunk = 1 + (ratio - 1) * (r.n / (r.n + TRUST_SHRINK));
    out[r.key] = Math.round(Math.min(TRUST_CEIL, Math.max(TRUST_FLOOR, shrunk)) * 1e4) / 1e4;
  }
  return out;
}

/** Only a stored number in the sane range is honoured; anything else is neutral. */
export const trustFor = (t: MarketTrust, key: string): number => {
  const v = t[key as MarketKey];
  return typeof v === "number" && v >= TRUST_FLOOR && v <= TRUST_CEIL ? v : 1;
};
