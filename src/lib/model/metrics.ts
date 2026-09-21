/** Brier over {home, draw, away}: Σ_k (p_k − o_k)². Range 0..2, lower is better. */
export function brier1x2(p: [number, number, number], outcome: 0 | 1 | 2): number {
  return p.reduce((s, pk, k) => s + (pk - (k === outcome ? 1 : 0)) ** 2, 0);
}
export function logLoss1x2(p: [number, number, number], outcome: 0 | 1 | 2): number {
  return -Math.log(Math.max(1e-12, p[outcome]));
}
export const outcomeOf = (h: number, a: number): 0 | 1 | 2 => (h > a ? 0 : h === a ? 1 : 2);
/** Baseline: always home (p = 1,0,0 would give infinite log loss, so use the league's home/draw/away base rates). */
export function alwaysHomeProbs(rates: { home: number; draw: number; away: number }): [number, number, number] {
  return [rates.home, rates.draw, rates.away];
}
