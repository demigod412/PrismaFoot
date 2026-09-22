/*
 * Accuracy maths for the public ledger. Pure functions (no database) so they are unit-tested.
 * Only LOCKED calls are ever passed in: the call as it stood 15 minutes before kickoff.
 */
import { formatInTimeZone } from "date-fns-tz";
import { marketHit, type MarketKey, type MarketTip } from "./markets";

export type Triple = [number, number, number]; // home, draw, away
export interface ScoredCall {
  fixtureId: string; leagueId: string; kickoff: Date; band: "HIGH" | "MEDIUM" | "LOW";
  cal: Triple; raw: Triple;
  h: number; a: number;
  hc?: number | null; ac?: number | null; hs?: number | null; as?: number | null;
  cornersLine?: number | null; shotsLine?: number | null;
  markets: MarketTip[];
  tableFav: 0 | 2 | null;   // league-table favourite at kickoff (home / away), null if no table yet
  closing: Triple | null;   // de-vigged 1X2 market probabilities before lock, if odds were fetched
}

export const outcome = (h: number, a: number): 0 | 1 | 2 => (h > a ? 0 : h === a ? 1 : 2);
export const brier = (p: Triple, o: number) => p.reduce((s, q, k) => s + (q - (k === o ? 1 : 0)) ** 2, 0);
export const logLoss = (p: Triple, o: number) => -Math.log(Math.max(1e-12, p[o]));
const argmax = (p: Triple) => p.indexOf(Math.max(...p));
const TABLE_FAV_P: Triple = [0.5, 0.27, 0.23]; // fixed baseline probabilities for "table favourite" (mirrored for away)

export function devig(odds: Triple): Triple {
  const inv = odds.map((o) => 1 / o), s = inv.reduce((x, y) => x + y, 0);
  return inv.map((x) => x / s) as Triple;
}

export interface Metrics { n: number; brier: number; logloss: number; hit: number }
const agg = (rows: { p: Triple; o: number }[]): Metrics => {
  const n = rows.length || 1;
  return { n: rows.length, brier: rows.reduce((s, r) => s + brier(r.p, r.o), 0) / n, logloss: rows.reduce((s, r) => s + logLoss(r.p, r.o), 0) / n, hit: rows.filter((r) => argmax(r.p) === r.o).length / n };
};

export interface AccuracyReport {
  n: number;
  model: Metrics;
  alwaysHome: Metrics;          // p = (1,0,0) for Brier/hit; league base rates for log loss (finite)
  tableFav: Metrics & { covered: number };
  market: { n: number; model: Metrics; market: Metrics } | null;
  byBand: Record<string, Metrics>;
  markets: { key: MarketKey; label: string; n: number; hit: number; avgP: number }[];
  calibration: { lo: number; hi: number; n: number; avgP: number; rate: number }[];
}

export function computeAccuracy(calls: ScoredCall[]): AccuracyReport {
  const rows = calls.map((c) => ({ c, o: outcome(c.h, c.a) }));
  const model = agg(rows.map((r) => ({ p: r.c.cal, o: r.o })));
  const n = rows.length || 1;
  const base: Triple = [0, 1, 2].map((k) => (rows.filter((r) => r.o === k).length + 1) / (rows.length + 3)) as Triple;
  const alwaysHome: Metrics = {
    n: rows.length, brier: rows.reduce((s, r) => s + brier([1, 0, 0], r.o), 0) / n,
    logloss: rows.reduce((s, r) => s + logLoss(base, r.o), 0) / n, hit: rows.filter((r) => r.o === 0).length / n,
  };
  const tf = rows.filter((r) => r.c.tableFav != null).map((r) => ({ p: (r.c.tableFav === 0 ? TABLE_FAV_P : [TABLE_FAV_P[2], TABLE_FAV_P[1], TABLE_FAV_P[0]]) as Triple, o: r.o }));
  const withOdds = rows.filter((r) => r.c.closing);
  const byBand: Record<string, Metrics> = {};
  for (const b of ["HIGH", "MEDIUM", "LOW"]) { const x = rows.filter((r) => r.c.band === b); if (x.length) byBand[b] = agg(x.map((r) => ({ p: r.c.cal, o: r.o }))); }

  // Market hit rates: every market the model backed (p ≥ 50%) on each call.
  const mk = new Map<MarketKey, { label: string; n: number; hit: number; p: number }>();
  for (const { c } of rows) for (const m of c.markets) {
    if (m.p < 0.5) continue;
    const hit = marketHit(m.key, { h: c.h, a: c.a, hc: c.hc, ac: c.ac, hs: c.hs, as: c.as }, { corners: c.cornersLine, shots: c.shotsLine });
    if (hit == null) continue;
    const e = mk.get(m.key) ?? { label: m.short, n: 0, hit: 0, p: 0 };
    e.n++; e.p += m.p; if (hit) e.hit++; mk.set(m.key, e);
  }
  // Calibration of the favourite's probability, 10-point buckets
  const buckets = Array.from({ length: 6 }, (_, i) => ({ lo: 0.35 + i * 0.1, hi: 0.45 + i * 0.1, n: 0, p: 0, y: 0 }));
  for (const { c, o } of rows) {
    const k = argmax(c.cal), pf = c.cal[k];
    const b = buckets.find((x) => pf >= x.lo && pf < x.hi) ?? (pf >= 0.85 ? buckets[5] : null);
    if (b) { b.n++; b.p += pf; if (k === o) b.y++; }
  }
  return {
    n: rows.length, model, alwaysHome,
    tableFav: { ...agg(tf), covered: tf.length },
    market: withOdds.length ? { n: withOdds.length, model: agg(withOdds.map((r) => ({ p: r.c.cal, o: r.o }))), market: agg(withOdds.map((r) => ({ p: r.c.closing!, o: r.o }))) } : null,
    byBand,
    markets: [...mk.entries()].map(([key, e]) => ({ key, label: e.label, n: e.n, hit: e.hit / e.n, avgP: e.p / e.n })).sort((a, b) => b.n - a.n),
    calibration: buckets.filter((b) => b.n).map((b) => ({ lo: b.lo, hi: Math.min(1, b.hi), n: b.n, avgP: b.p / b.n, rate: b.y / b.n })),
  };
}

/** Per-day series (WAT calendar days, by kickoff). */
export function dailySeries(calls: ScoredCall[], tz = "Africa/Lagos") {
  const by = new Map<string, ScoredCall[]>();
  for (const c of calls) { const k = formatInTimeZone(c.kickoff, tz, "yyyy-MM-dd"); by.set(k, [...(by.get(k) ?? []), c]); }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cs]) => ({ day, calls: cs, report: computeAccuracy(cs) }));
}

/**
 * League-table favourite at kickoff for each target fixture, from all finished league results before it.
 * Returns fixtureId → 0 (home higher) | 2 (away higher) | null (no table yet or level on points).
 */
export function tableFavourites(results: { id: string; leagueId: string; kickoff: Date; homeId: string; awayId: string; h: number; a: number }[],
  targets: { id: string; leagueId: string; kickoff: Date; homeId: string; awayId: string }[]) {
  const out = new Map<string, 0 | 2 | null>();
  const byLeague = new Map<string, typeof results>();
  results.forEach((r) => byLeague.set(r.leagueId, [...(byLeague.get(r.leagueId) ?? []), r]));
  for (const t of targets) {
    const pts = new Map<string, number>(); let played = 0;
    for (const r of byLeague.get(t.leagueId) ?? []) {
      if (r.kickoff >= t.kickoff) continue;
      played++;
      const [ph, pa] = r.h > r.a ? [3, 0] : r.h === r.a ? [1, 1] : [0, 3];
      pts.set(r.homeId, (pts.get(r.homeId) ?? 0) + ph); pts.set(r.awayId, (pts.get(r.awayId) ?? 0) + pa);
    }
    const hp = pts.get(t.homeId), ap = pts.get(t.awayId);
    out.set(t.id, played < 10 || hp == null || ap == null || hp === ap ? null : hp > ap ? 0 : 2);
  }
  return out;
}
