import type { Prediction } from "@prisma/client";
import { allMarkets, type MarketTip } from "./markets";
import type { QuoteMap } from "./odds";

/*
 * Value tips: where the model's probability is higher than the bookmaker's price implies.
 *   expected value per 1 unit staked = p × odds − 1      (edge)
 * Filters: Medium/High confidence, p ≥ 35%, median odds 1.40–6.00, edge ≥ 3%. One tip per match, ranked by edge.
 * Edges are only as good as the model's calibration — they are estimates, not guarantees.
 */
export const VALUE = { minP: 0.35, minOdds: 1.4, maxOdds: 6, minEdge: 0.03, topN: 20 };
/** Odds ceilings offered on the value list. Shorter prices mean safer legs and a steadier record. */
export const VALUE_CEILINGS = [2, 3, 6] as const;
/** ★ marks standout value: a High-confidence call with a clear edge, not just a qualifying one. */
export const isStarred = (t: { edge: number; band: string; p: number }) => t.band === "HIGH" && t.edge >= 0.08 && t.p >= 0.5;
export interface ValueTip extends MarketTip { odds: number; best: number; books: number; edge: number; fair: number; star?: boolean }

export function valueTips(p: Prediction, quotes: QuoteMap, home: string, away: string, opts: { maxOdds?: number } = {}): ValueTip[] {
  if (p.band === "LOW") return [];
  return allMarkets(p, home, away).flatMap((m) => {
    const q = quotes[m.key];
    if (!q || m.p < VALUE.minP || q.odds < VALUE.minOdds || q.odds > (opts.maxOdds ?? VALUE.maxOdds)) return [];
    const edge = m.p * q.odds - 1;
    return edge >= VALUE.minEdge ? [{ ...m, odds: q.odds, best: q.best, books: q.books, edge, fair: 1 / m.p, star: isStarred({ edge, band: p.band, p: m.p }) }] : [];
  }).sort((a, b) => b.edge - a.edge);
}

export function selectTopValue<T>(items: { item: T; id: string; tips: ValueTip[]; startMs: number }[], n = VALUE.topN) {
  return items.flatMap((x) => (x.tips[0] ? [{ item: x.item, tip: x.tips[0], startMs: x.startMs }] : []))
    .sort((a, b) => b.tip.edge - a.tip.edge || a.startMs - b.startMs).slice(0, n);
}

/** Flat 1-unit stakes at the quoted odds: profit and return on investment. */
export function flatStakeRoi(bets: { odds: number; hit: boolean }[]) {
  const profit = bets.reduce((s, b) => s + (b.hit ? b.odds - 1 : -1), 0);
  return { n: bets.length, hits: bets.filter((b) => b.hit).length, profit, roi: bets.length ? profit / bets.length : 0 };
}
