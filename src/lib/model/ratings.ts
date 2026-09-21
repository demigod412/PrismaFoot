import { DEFAULT_RHO, HALF_LIFE_DAYS, RHO_PRIOR_MATCHES, SHRINK_PSEUDO_MATCHES } from "./constants";
import { clampRho, dcLogLik } from "./dixonColes";

export type InputKind = "xg" | "shots" | "goals";

export interface HistMatch {
  homeId: string;
  awayId: string;
  date: Date;
  homeGoals: number;
  awayGoals: number;
  homeXg?: number | null;
  awayXg?: number | null;
  homeShots?: number | null;
  awayShots?: number | null;
}

export interface TeamRating {
  attack: number;   // α  (goals vs an average defence, neutral venue)
  defence: number;  // β  (multiplier on opponent's attack; 1 = average, >1 = leaky)
  sampleWeight: number; // Σ recency weights = effective sample
  matches: number;
}

export interface LeagueFit {
  inputKind: InputKind;
  teams: Map<string, TeamRating>;
  homeAdv: number; // γ_league
  base: number;    // league mean goals per side at neutral venue
  rho: number;
  rhoRaw: number | null;
  volatility: number; // 0..1
  n: number;
}

export function recencyWeight(daysAgo: number, h = HALF_LIFE_DAYS): number {
  return Math.exp((-Math.LN2 * Math.max(0, daysAgo)) / h);
}

/** Pick the best input available on (almost) every match. */
export function chooseInputKind(ms: HistMatch[]): InputKind {
  if (ms.length === 0) return "goals";
  const cov = (f: (m: HistMatch) => boolean) => ms.filter(f).length / ms.length;
  if (cov((m) => m.homeXg != null && m.awayXg != null) >= 0.9) return "xg";
  if (cov((m) => m.homeShots != null && m.awayShots != null) >= 0.9) return "shots";
  return "goals";
}

/**
 * Weighted multiplicative Poisson fit (Maher-style iterative scaling):
 *   E[H] = c · a_H · d_A · γ     E[A] = c · a_A · d_H
 * with mean(a) = mean(d) = 1. We report α = c·a and β = d so that
 *   λ_H = α_H · β_A · γ,   λ_A = α_A · β_H   (exactly the spec's form).
 * Shrinkage: every team gets SHRINK_PSEUDO_MATCHES pseudo-matches at league average.
 */
export function fitLeague(matches: HistMatch[], asOf: Date, opts: { iterations?: number } = {}): LeagueFit {
  const kind = chooseInputKind(matches);
  const ms = matches.filter((m) => m.date < asOf);
  // Shots → goal-equivalents via league conversion rate.
  let conv = 0.1;
  if (kind === "shots") {
    const g = ms.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
    const sh = ms.reduce((s, m) => s + (m.homeShots ?? 0) + (m.awayShots ?? 0), 0);
    conv = sh > 0 ? g / sh : 0.1;
  }
  const y = (m: HistMatch, side: "h" | "a") =>
    kind === "xg" ? (side === "h" ? m.homeXg! : m.awayXg!)
    : kind === "shots" ? (side === "h" ? m.homeShots! : m.awayShots!) * conv
    : side === "h" ? m.homeGoals : m.awayGoals;

  const w = ms.map((m) => recencyWeight((asOf.getTime() - m.date.getTime()) / 86_400_000));
  const ids = new Set<string>();
  ms.forEach((m) => { ids.add(m.homeId); ids.add(m.awayId); });
  const a = new Map<string, number>(); const d = new Map<string, number>();
  ids.forEach((id) => { a.set(id, 1); d.set(id, 1); });

  const sw = w.reduce((s, x) => s + x, 0) || 1;
  const hg = ms.reduce((s, m, k) => s + w[k] * y(m, "h"), 0);
  const ag = ms.reduce((s, m, k) => s + w[k] * y(m, "a"), 0);
  let c = Math.max(0.3, ag / sw);
  let g = ag > 0 ? Math.min(1.6, Math.max(0.9, hg / ag)) : 1.25;
  const K = SHRINK_PSEUDO_MATCHES;

  for (let it = 0; it < (opts.iterations ?? 40); it++) {
    // attack
    const numA = new Map<string, number>(); const denA = new Map<string, number>();
    ids.forEach((id) => { numA.set(id, K * c * (1 + g) / 2); denA.set(id, K * c * (1 + g) / 2); });
    ms.forEach((m, k) => {
      numA.set(m.homeId, numA.get(m.homeId)! + w[k] * y(m, "h"));
      denA.set(m.homeId, denA.get(m.homeId)! + w[k] * c * d.get(m.awayId)! * g);
      numA.set(m.awayId, numA.get(m.awayId)! + w[k] * y(m, "a"));
      denA.set(m.awayId, denA.get(m.awayId)! + w[k] * c * d.get(m.homeId)!);
    });
    ids.forEach((id) => a.set(id, numA.get(id)! / denA.get(id)!));
    // defence
    const numD = new Map<string, number>(); const denD = new Map<string, number>();
    ids.forEach((id) => { numD.set(id, K * c * (1 + g) / 2); denD.set(id, K * c * (1 + g) / 2); });
    ms.forEach((m, k) => {
      numD.set(m.awayId, numD.get(m.awayId)! + w[k] * y(m, "h"));
      denD.set(m.awayId, denD.get(m.awayId)! + w[k] * c * a.get(m.homeId)! * g);
      numD.set(m.homeId, numD.get(m.homeId)! + w[k] * y(m, "a"));
      denD.set(m.homeId, denD.get(m.homeId)! + w[k] * c * a.get(m.awayId)!);
    });
    ids.forEach((id) => d.set(id, numD.get(id)! / denD.get(id)!));
    // normalize means to 1
    const ma = mean([...a.values()]); const md = mean([...d.values()]);
    ids.forEach((id) => { a.set(id, a.get(id)! / ma); d.set(id, d.get(id)! / md); });
    // home advantage and scale
    let nh = 0, dh = 0, nc = 0, dc = 0;
    ms.forEach((m, k) => {
      const eh = c * a.get(m.homeId)! * d.get(m.awayId)!;
      const ea = c * a.get(m.awayId)! * d.get(m.homeId)!;
      nh += w[k] * y(m, "h"); dh += w[k] * eh;
      nc += w[k] * (y(m, "h") + y(m, "a")); dc += w[k] * (eh * g + ea) / c;
    });
    if (dh > 0) g = Math.min(1.8, Math.max(0.85, nh / dh));
    if (dc > 0) c = Math.max(0.3, nc / dc);
  }

  const teams = new Map<string, TeamRating>();
  ids.forEach((id) => {
    let sWeight = 0, n = 0;
    ms.forEach((m, k) => { if (m.homeId === id || m.awayId === id) { sWeight += w[k]; n++; } });
    teams.set(id, { attack: c * a.get(id)!, defence: d.get(id)!, sampleWeight: sWeight, matches: n });
  });

  // ρ: weighted ML grid search on ACTUAL goals, shrunk toward DEFAULT_RHO.
  let rhoRaw: number | null = null;
  if (ms.length >= 60) {
    let best = -Infinity;
    for (let r = -0.25; r <= 0.1001; r += 0.005) {
      let ll = 0;
      ms.forEach((m, k) => {
        const t1 = teams.get(m.homeId)!, t2 = teams.get(m.awayId)!;
        const lam = t1.attack * t2.defence * g, mu = t2.attack * t1.defence;
        ll += w[k] * dcLogLik(m.homeGoals, m.awayGoals, lam, mu, clampRho(r, lam, mu));
      });
      if (ll > best) { best = ll; rhoRaw = r; }
    }
  }
  const nEff = ms.length;
  const rho = rhoRaw == null ? DEFAULT_RHO
    : (nEff * rhoRaw + RHO_PRIOR_MATCHES * DEFAULT_RHO) / (nEff + RHO_PRIOR_MATCHES);

  // Volatility: mean squared Pearson residual of total goals, mapped to 0..1 (1.0 dispersion ≈ Poisson ≈ 0.5).
  let disp = 1;
  if (ms.length >= 20) {
    let s = 0;
    ms.forEach((m) => {
      const t1 = teams.get(m.homeId)!, t2 = teams.get(m.awayId)!;
      const e = t1.attack * t2.defence * g + t2.attack * t1.defence;
      s += (m.homeGoals + m.awayGoals - e) ** 2 / e;
    });
    disp = s / ms.length;
  }
  const volatility = Math.max(0, Math.min(1, disp / 2));

  return { inputKind: kind, teams, homeAdv: g, base: c, rho, rhoRaw, volatility, n: ms.length };
}

function mean(xs: number[]) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 1; }

/** Rating for a team with no history: league average with zero sample. */
export function priorRating(fit: LeagueFit): TeamRating {
  return { attack: fit.base, defence: 1, sampleWeight: 0, matches: 0 };
}
