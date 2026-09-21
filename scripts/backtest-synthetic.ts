/**
 * Walk-forward sanity check on simulated leagues (no DB):
 * fit on everything before each matchweek, predict it, score Brier/log loss vs baselines.
 * Run: npx tsx scripts/backtest-synthetic.ts
 */
import { fitLeague, type HistMatch } from "../src/lib/model/ratings";
import { predictFixture } from "../src/lib/model/predict";
import { brier1x2, logLoss1x2, outcomeOf } from "../src/lib/model/metrics";
import { makeRng, poissonSample } from "../src/lib/demo/rng";

const rng = makeRng(42);
const N = 20, DAY = 864e5, start = Date.UTC(2025, 7, 1);
const truth = Array.from({ length: N }, () => ({ a: Math.exp((rng() - 0.5) * 0.8), d: Math.exp((rng() - 0.5) * 0.7) }));
const base = 1.25, home = 1.28;
const all: HistMatch[] = [];
for (let season = 0; season < 2; season++) for (let r = 0; r < 38; r++) {
  const perm = [...Array(N).keys()].sort(() => rng() - 0.5);
  for (let k = 0; k < N; k += 2) {
    const h = perm[k], a = perm[k + 1];
    all.push({ homeId: `t${h}`, awayId: `t${a}`, date: new Date(start + (season * 40 + r) * 7 * DAY),
      homeGoals: poissonSample(rng, base * truth[h].a * truth[a].d * home), awayGoals: poissonSample(rng, base * truth[a].a * truth[h].d) });
  }
}
const weeks = [...new Set(all.map((m) => m.date.getTime()))].sort();
const agg = { model: [0, 0, 0], home: [0, 0, 0], table: [0, 0, 0], n: 0 };
const bands: Record<string, { n: number; hit: number }> = {};
type Mk = { calls: number; hits: number; sumP: number; occ: number; brier: number; n: number };
const mk = () => ({ calls: 0, hits: 0, sumP: 0, occ: 0, brier: 0, n: 0 } as Mk);
const markets: Record<string, Mk> = { "Over 1.5": mk(), "Over 2.5": mk(), "Over 3.5": mk(), "Over 4.5": mk(), "Under 2.5": mk(), "Under 3.5": mk(), "Under 4.5": mk(), "BTTS": mk(), "Home win": mk(), "Draw": mk(), "Away win": mk() };
const scanners: Record<string, { calls: number; hits: number; sumP: number }> = { "Win (Med+, margin≥0.10)": { calls: 0, hits: 0, sumP: 0 }, "O2.5 ≥ 55%": { calls: 0, hits: 0, sumP: 0 }, "BTTS ≥ 55%": { calls: 0, hits: 0, sumP: 0 }, "O1.5 ≥ 72%": { calls: 0, hits: 0, sumP: 0 }, "Draw ≥ 30%": { calls: 0, hits: 0, sumP: 0 }, "U2.5 ≥ 55%": { calls: 0, hits: 0, sumP: 0 }, "U3.5 ≥ 72%": { calls: 0, hits: 0, sumP: 0 }, "U4.5 ≥ 85%": { calls: 0, hits: 0, sumP: 0 } };
const binary = (k: string, p: number, happened: boolean, callThreshold = 0.5) => { const m = markets[k]; m.n++; m.sumP += p; m.occ += happened ? 1 : 0; m.brier += (p - (happened ? 1 : 0)) ** 2; if (p >= callThreshold) { m.calls++; if (happened) m.hits++; } };
const sc = (k: string, ok: boolean, p: number, hit: boolean) => { if (!ok) return; const s = scanners[k]; s.calls++; s.sumP += p; if (hit) s.hits++; };
for (const w of weeks.slice(38)) { // second season only, first season is warm-up
  const past = all.filter((m) => m.date.getTime() < w);
  const fit = fitLeague(past, new Date(w));
  const hr = past.filter((m) => m.homeGoals > m.awayGoals).length / past.length, dr = past.filter((m) => m.homeGoals === m.awayGoals).length / past.length;
  const pts = new Map<string, number>();
  past.filter((m) => m.date.getTime() > w - 300 * DAY).forEach((m) => {
    const o = outcomeOf(m.homeGoals, m.awayGoals);
    pts.set(m.homeId, (pts.get(m.homeId) ?? 0) + (o === 0 ? 3 : o === 1 ? 1 : 0));
    pts.set(m.awayId, (pts.get(m.awayId) ?? 0) + (o === 2 ? 3 : o === 1 ? 1 : 0));
  });
  for (const m of all.filter((x) => x.date.getTime() === w)) {
    const out = predictFixture({ fit, homeId: m.homeId, awayId: m.awayId, homeName: "", awayName: "", kickoff: m.date,
      restHomeDays: 7, restAwayDays: 7, newsHome: { confirmedStarterAbsences: 0 }, newsAway: { confirmedStarterAbsences: 0 }, formHome: "", formAway: "" });
    const o = outcomeOf(m.homeGoals, m.awayGoals);
    const pm: [number, number, number] = [out.cal.home, out.cal.draw, out.cal.away];
    const ph: [number, number, number] = [hr, dr, 1 - hr - dr]; // always-home as base rates (finite log loss)
    const fav = (pts.get(m.homeId) ?? 0) >= (pts.get(m.awayId) ?? 0) ? 0 : 2;
    const pt: [number, number, number] = fav === 0 ? [0.5, 0.27, 0.23] : [0.3, 0.27, 0.43];
    const add = (arr: number[], p: [number, number, number], call: number) => { arr[0] += brier1x2(p, o); arr[1] += logLoss1x2(p, o); arr[2] += call === o ? 1 : 0; };
    add(agg.model, pm, pm.indexOf(Math.max(...pm))); add(agg.home, ph, 0); add(agg.table, pt, fav); agg.n++;
    const tg = m.homeGoals + m.awayGoals, bt = m.homeGoals > 0 && m.awayGoals > 0;
    binary("Over 1.5", out.cal.over15, tg >= 2); binary("Over 2.5", out.cal.over25, tg >= 3); binary("Over 3.5", out.cal.over35, tg >= 4); binary("Over 4.5", out.cal.over45, tg >= 5);
    binary("Under 2.5", 1 - out.cal.over25, tg <= 2); binary("Under 3.5", 1 - out.cal.over35, tg <= 3); binary("Under 4.5", 1 - out.cal.over45, tg <= 4); binary("BTTS", out.cal.btts, bt);
    binary("Home win", out.cal.home, o === 0); binary("Draw", out.cal.draw, o === 1); binary("Away win", out.cal.away, o === 2);
    const sorted = [...pm].sort((x, y) => y - x), top = pm.indexOf(sorted[0]);
    sc("Win (Med+, margin≥0.10)", top !== 1 && out.band !== "LOW" && sorted[0] - sorted[1] >= 0.1, sorted[0], top === o);
    sc("O2.5 ≥ 55%", out.cal.over25 >= 0.55, out.cal.over25, tg >= 3); sc("BTTS ≥ 55%", out.cal.btts >= 0.55, out.cal.btts, bt);
    sc("O1.5 ≥ 72%", out.cal.over15 >= 0.72, out.cal.over15, tg >= 2); sc("Draw ≥ 30%", out.cal.draw >= 0.3, out.cal.draw, o === 1);
    sc("U2.5 ≥ 55%", 1 - out.cal.over25 >= 0.55, 1 - out.cal.over25, tg <= 2); sc("U3.5 ≥ 72%", 1 - out.cal.over35 >= 0.72, 1 - out.cal.over35, tg <= 3); sc("U4.5 ≥ 85%", 1 - out.cal.over45 >= 0.85, 1 - out.cal.over45, tg <= 4);
    const b = (bands[out.band] ??= { n: 0, hit: 0 }); b.n++; if (pm.indexOf(Math.max(...pm)) === o) b.hit++;
  }
}
const row = (k: string, a: number[]) => console.log(k.padEnd(14), "Brier", (a[0] / agg.n).toFixed(4), " LogLoss", (a[1] / agg.n).toFixed(4), " Hit", ((a[2] / agg.n) * 100).toFixed(1) + "%");
console.log(`n = ${agg.n} simulated matches (walk-forward)`);
row("dc-xg-cal-v1", agg.model); row("always-home", agg.home); row("table-fav", agg.table);
console.log("by band:", Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, `${v.n} calls, ${((v.hit / v.n) * 100).toFixed(0)}% hit`])));

console.log("\nMARKETS (call = model p ≥ 50%)");
for (const [k, m] of Object.entries(markets)) console.log(k.padEnd(10), `calls ${String(m.calls).padStart(3)}  hit ${m.calls ? ((m.hits / m.calls) * 100).toFixed(1) : "–"}%  | avg p ${((m.sumP / m.n) * 100).toFixed(1)}% vs actual ${((m.occ / m.n) * 100).toFixed(1)}%  | Brier ${(m.brier / m.n).toFixed(4)}`);
console.log("\nSCANNERS");
for (const [k, s] of Object.entries(scanners)) console.log(k.padEnd(24), `calls ${String(s.calls).padStart(3)}  hit ${s.calls ? ((s.hits / s.calls) * 100).toFixed(1) : "–"}%  avg p ${s.calls ? ((s.sumP / s.calls) * 100).toFixed(1) : "–"}%`);
