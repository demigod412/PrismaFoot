import { MAX_GOALS } from "./constants";

/** Poisson pmf, computed in log space for stability. */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logFact = 0;
  for (let i = 2; i <= k; i++) logFact += Math.log(i);
  return Math.exp(k * Math.log(lambda) - lambda - logFact);
}

/**
 * Dixon–Coles low-score dependence factor τ.
 *   τ(0,0) = 1 − λμρ
 *   τ(0,1) = 1 + λρ
 *   τ(1,0) = 1 + μρ
 *   τ(1,1) = 1 − ρ
 *   τ(i,j) = 1 otherwise
 * λ = home expected goals, μ = away expected goals.
 */
export function tau(i: number, j: number, lambda: number, mu: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lambda * mu * rho;
  if (i === 0 && j === 1) return 1 + lambda * rho;
  if (i === 1 && j === 0) return 1 + mu * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

/** Valid ρ range so every τ ≥ 0: max(−1/λ, −1/μ) ≤ ρ ≤ min(1/(λμ), 1). */
export function clampRho(rho: number, lambda: number, mu: number): number {
  const lo = Math.max(-1 / Math.max(lambda, 1e-9), -1 / Math.max(mu, 1e-9));
  const hi = Math.min(1 / Math.max(lambda * mu, 1e-9), 1);
  return Math.min(hi - 1e-6, Math.max(lo + 1e-6, rho));
}

export type Matrix = number[][]; // m[homeGoals][awayGoals]

/** Scoreline matrix: Poisson × Poisson × τ, renormalized to sum to exactly 1. */
export function scoreMatrix(lambda: number, mu: number, rho: number, maxGoals = MAX_GOALS): Matrix {
  const r = clampRho(rho, lambda, mu);
  const ph = Array.from({ length: maxGoals + 1 }, (_, i) => poissonPmf(i, lambda));
  const pa = Array.from({ length: maxGoals + 1 }, (_, j) => poissonPmf(j, mu));
  const m: Matrix = [];
  let total = 0;
  for (let i = 0; i <= maxGoals; i++) {
    m.push([]);
    for (let j = 0; j <= maxGoals; j++) {
      const v = ph[i] * pa[j] * tau(i, j, lambda, mu, r);
      m[i].push(v);
      total += v;
    }
  }
  for (let i = 0; i <= maxGoals; i++) for (let j = 0; j <= maxGoals; j++) m[i][j] /= total;
  return m;
}

export interface Markets {
  home: number;
  draw: number;
  away: number;
  over15: number;
  over25: number;
  over35: number;
  over45: number;
  btts: number;
}

/** Every market is a sum over matrix cells — the matrix is the only source. */
export function marketsFromMatrix(m: Matrix): Markets {
  let home = 0, draw = 0, away = 0, o15 = 0, o25 = 0, o35 = 0, o45 = 0, btts = 0;
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
      const t = i + j;
      if (t >= 2) o15 += p;
      if (t >= 3) o25 += p;
      if (t >= 4) o35 += p;
      if (t >= 5) o45 += p;
      if (i >= 1 && j >= 1) btts += p;
    }
  }
  return { home, draw, away, over15: o15, over25: o25, over35: o35, over45: o45, btts };
}

export interface Scoreline { h: number; a: number; p: number }

/** Under lines are exact complements of the matching over lines (whole-number totals can't land on .5). */
export function unders(m: Pick<Markets, "over25" | "over35" | "over45">) {
  return { under25: 1 - m.over25, under35: 1 - m.over35, under45: 1 - m.over45 };
}

/** P(home wins by ≥ k) and P(away wins by ≥ k). k = 2 is the "win by 2+ goals" (Asian −1.5) market. */
export function winByAtLeast(m: Matrix, k: number) {
  let home = 0, away = 0;
  m.forEach((row, i) => row.forEach((p, j) => { if (i - j >= k) home += p; if (j - i >= k) away += p; }));
  return { home, away };
}

/**
 * Half markets from the full-time matrix: each goal falls in the first half independently with probability s
 * (league-fitted share, ~0.45). 1H total | T ~ Binomial(T, s); 2H total | T ~ Binomial(T, 1 − s).
 */
export function halfUnders(m: Matrix, s: number) {
  const pT: number[] = [];
  m.forEach((row, i) => row.forEach((p, j) => { pT[i + j] = (pT[i + j] ?? 0) + p; }));
  const binomCdf = (k: number, n: number, q: number) => { let c = 0, t = Math.pow(1 - q, n); for (let x = 0; x <= Math.min(k, n); x++) { c += t; t *= ((n - x) / (x + 1)) * (q / (1 - q)); } return c; };
  let h1u15 = 0, h1u25 = 0, h2u25 = 0;
  pT.forEach((p, n) => { if (!p) return; h1u15 += p * binomCdf(1, n, s); h1u25 += p * binomCdf(2, n, s); h2u25 += p * binomCdf(2, n, 1 - s); });
  return { h1u15, h1u25, h2u25 };
}

/** P(side wins OR 3+ goals) — "win or over 2.5". */
export function winOrOver(m: Matrix, line = 2.5) {
  let home = 0, away = 0, homeAndOver = 0, awayAndOver = 0;
  m.forEach((row, i) => row.forEach((p, j) => {
    const over = i + j > line;
    if (i > j || over) home += p; if (j > i || over) away += p;
    if (i > j && over) homeAndOver += p; if (j > i && over) awayAndOver += p;
  }));
  return { home, away, homeAndOver, awayAndOver };
}

/** European handicap on the HOME side: result of (home + h) vs away → [home, draw, away] probabilities. */
export function europeanHandicap(m: number[][], h: number): [number, number, number] {
  let a = 0, d = 0, b = 0;
  m.forEach((row, i) => row.forEach((p, j) => { const x = i + h - j; if (x > 0) a += p; else if (x === 0) d += p; else b += p; }));
  const s = a + d + b || 1;
  return [a / s, d / s, b / s];
}

export function topScorelines(m: Matrix, n = 5): Scoreline[] {
  const cells: Scoreline[] = [];
  m.forEach((row, i) => row.forEach((p, j) => cells.push({ h: i, a: j, p })));
  return cells.sort((x, y) => y.p - x.p).slice(0, n);
}

/** Truncate for storage/heatmap (0..6 × 0..6 is what the UI draws). */
export function truncateMatrix(m: Matrix, size = 7): number[][] {
  return m.slice(0, size).map((row) => row.slice(0, size).map((p) => Math.round(p * 1e5) / 1e5));
}

/** Log-likelihood of one observed score under DC. Used for ρ fitting. */
export function dcLogLik(h: number, a: number, lambda: number, mu: number, rho: number): number {
  const t = tau(h, a, lambda, mu, rho);
  if (t <= 0) return -Infinity;
  return Math.log(t) + Math.log(poissonPmf(h, lambda)) + Math.log(poissonPmf(a, mu));
}
