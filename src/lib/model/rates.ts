/*
 * Corners and total shots: a team-strength count model, separate from goals.
 *   E[home] = c · a_H · d_A · γ      E[away] = c · a_A · d_H    (recency-weighted iterative scaling, shrunk toward average)
 * Total = home + away, modelled as negative binomial with the same mean and variance
 * (dispersion r fitted by moments on team counts).  P(over L) = 1 − CDF(floor(L)).
 */
import { recencyWeight } from "./ratings";

export interface RateMatch { homeId: string; awayId: string; date: Date; h: number; a: number }
export interface RateFit { base: number; home: number; r: number | null; teams: Map<string, { a: number; d: number; n: number }>; n: number }

export const MIN_RATE_MATCHES = 80; // per league, before corners/shots predictions are shown

export function fitRates(ms0: RateMatch[], asOf: Date, halfLife = 120, K = 6): RateFit {
  const ms = ms0.filter((m) => m.date < asOf);
  const w = ms.map((m) => recencyWeight((asOf.getTime() - m.date.getTime()) / 86_400_000, halfLife));
  const ids = new Set<string>(); ms.forEach((m) => { ids.add(m.homeId); ids.add(m.awayId); });
  const a = new Map<string, number>(), d = new Map<string, number>(); ids.forEach((i) => { a.set(i, 1); d.set(i, 1); });
  const sw = w.reduce((s, x) => s + x, 0) || 1;
  let c = Math.max(0.5, ms.reduce((s, m, k) => s + w[k] * m.a, 0) / sw);
  let g = 1.1;
  for (let it = 0; it < 30; it++) {
    for (const [T, O] of [[a, d], [d, a]] as const) {
      const num = new Map<string, number>(), den = new Map<string, number>();
      ids.forEach((i) => { num.set(i, K * c); den.set(i, K * c); });
      ms.forEach((m, k) => {
        if (T === a) {
          num.set(m.homeId, num.get(m.homeId)! + w[k] * m.h); den.set(m.homeId, den.get(m.homeId)! + w[k] * c * O.get(m.awayId)! * g);
          num.set(m.awayId, num.get(m.awayId)! + w[k] * m.a); den.set(m.awayId, den.get(m.awayId)! + w[k] * c * O.get(m.homeId)!);
        } else {
          num.set(m.awayId, num.get(m.awayId)! + w[k] * m.h); den.set(m.awayId, den.get(m.awayId)! + w[k] * c * O.get(m.homeId)! * g);
          num.set(m.homeId, num.get(m.homeId)! + w[k] * m.a); den.set(m.homeId, den.get(m.homeId)! + w[k] * c * O.get(m.awayId)!);
        }
      });
      ids.forEach((i) => T.set(i, num.get(i)! / den.get(i)!));
      const mean = [...T.values()].reduce((s, x) => s + x, 0) / (ids.size || 1) || 1;
      ids.forEach((i) => T.set(i, T.get(i)! / mean));
    }
    let nh = 0, dh = 0, nc = 0, dc = 0;
    ms.forEach((m, k) => {
      const eh = a.get(m.homeId)! * d.get(m.awayId)!, ea = a.get(m.awayId)! * d.get(m.homeId)!;
      nh += w[k] * m.h; dh += w[k] * c * eh; nc += w[k] * (m.h + m.a); dc += w[k] * (eh * g + ea);
    });
    if (dh > 0) g = Math.min(1.5, Math.max(0.8, nh / dh));
    if (dc > 0) c = Math.max(0.5, nc / dc);
  }
  let s2 = 0, s1 = 0;
  ms.forEach((m) => {
    const eh = c * a.get(m.homeId)! * d.get(m.awayId)! * g, ea = c * a.get(m.awayId)! * d.get(m.homeId)!;
    for (const [y, mu] of [[m.h, eh], [m.a, ea]]) { s2 += mu * mu; s1 += (y - mu) ** 2 - mu; }
  });
  const r = s1 > 0 ? Math.min(200, Math.max(1.5, s2 / s1)) : null;
  const teams = new Map<string, { a: number; d: number; n: number }>();
  ids.forEach((i) => teams.set(i, { a: a.get(i)!, d: d.get(i)!, n: ms.filter((m) => m.homeId === i || m.awayId === i).length }));
  return { base: c, home: g, r, teams, n: ms.length };
}

function lgamma(x: number): number {
  const g = 7, cf = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let s = cf[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) s += cf[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
}
function pmf(k: number, mu: number, r: number | null) {
  if (r == null) { let lf = 0; for (let i = 2; i <= k; i++) lf += Math.log(i); return Math.exp(k * Math.log(mu) - mu - lf); }
  return Math.exp(lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(r / (r + mu)) + k * Math.log(mu / (r + mu)));
}

export function predictTotal(fit: RateFit, homeId: string, awayId: string, line: number) {
  const th = fit.teams.get(homeId) ?? { a: 1, d: 1, n: 0 }, ta = fit.teams.get(awayId) ?? { a: 1, d: 1, n: 0 };
  const mh = fit.base * th.a * ta.d * fit.home, ma = fit.base * ta.a * th.d, mu = mh + ma;
  const variance = fit.r == null ? mu : mh + mh * mh / fit.r + ma + ma * ma / fit.r;
  const rT = variance > mu ? (mu * mu) / (variance - mu) : null;
  let cdf = 0; for (let k = 0; k <= Math.floor(line); k++) cdf += pmf(k, mu, rT);
  return { expected: mu, over: Math.min(1, Math.max(0, 1 - cdf)), sample: Math.min(th.n, ta.n) };
}
