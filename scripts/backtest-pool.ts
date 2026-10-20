/**
 * Walk-forward check of the pooled fit on a simulated pyramid (no DB): four leagues of different
 * strength, a knockout cup between them, and non-league "outsiders" seen only in the cup.
 * Compares the plain single fit (what pooled cups used before 0.23.0) with fitPool, on cup ties only.
 * Run: npx tsx scripts/backtest-pool.ts
 */
import { fitLeague, fitPool, type HistMatch, type PoolMember } from "../src/lib/model/ratings";
import { predictFixture } from "../src/lib/model/predict";
import { brier1x2, logLoss1x2, outcomeOf } from "../src/lib/model/metrics";
import { makeRng, poissonSample } from "../src/lib/demo/rng";

const DAY = 864e5, start = Date.UTC(2024, 7, 1);
const total = { single: [0, 0, 0], pool: [0, 0, 0], n: 0 };
const outs = { single: [0, 0], pool: [0, 0], n: 0 };

for (let seed = 1; seed <= 12; seed++) {
  const rng = makeRng(seed);
  const TIERS = 4, PER = 20, OUTSIDERS = 24;
  // Each tier is ~25% weaker in attack and ~20% leakier than the one above; clubs vary inside it.
  const teams = [...Array(TIERS * PER).keys()].map((i) => {
    const t = Math.floor(i / PER);
    return { id: `t${i}`, tier: t + 1, a: Math.pow(0.78, t) * Math.exp((rng() - 0.5) * 0.6), d: Math.pow(1.22, t) * Math.exp((rng() - 0.5) * 0.5) };
  });
  const outsiders = [...Array(OUTSIDERS).keys()].map((i) => ({ id: `o${i}`, tier: TIERS + 1, a: Math.pow(0.78, TIERS) * Math.exp((rng() - 0.5) * 0.6), d: Math.pow(1.22, TIERS) * Math.exp((rng() - 0.5) * 0.5) }));
  const all = [...teams, ...outsiders];
  const byId = new Map(all.map((t) => [t.id, t]));
  const base = 1.15, home = 1.3;
  const play = (h: string, a: string, date: number, cup: boolean): HistMatch & { cup: boolean } => {
    const H = byId.get(h)!, A = byId.get(a)!;
    return { homeId: h, awayId: a, date: new Date(date), cup,
      homeGoals: poissonSample(rng, base * H.a * A.d * home), awayGoals: poissonSample(rng, base * A.a * H.d) };
  };
  const ms: (HistMatch & { cup: boolean })[] = [];
  for (let season = 0; season < 2; season++) {
    for (let r = 0; r < 38; r++) {
      const day = start + (season * 365 + r * 7) * DAY;
      for (let t = 0; t < TIERS; t++) {
        const perm = teams.filter((x) => x.tier === t + 1).map((x) => x.id).sort(() => rng() - 0.5);
        for (let k = 0; k < PER; k += 2) ms.push(play(perm[k], perm[k + 1], day, false));
      }
      // A cup round every sixth week: random draw across the whole pyramid plus the outsiders.
      if (r % 6 === 3) {
        const drawn = [...all].sort(() => rng() - 0.5).slice(0, 32).map((x) => x.id);
        for (let k = 0; k < drawn.length; k += 2) ms.push(play(drawn[k], drawn[k + 1], day + 3 * DAY, true));
      }
    }
  }
  const members = new Map<string, PoolMember>(teams.map((t) => [t.id, { group: `L${t.tier}`, tier: t.tier }]));
  const cupDays = [...new Set(ms.filter((m) => m.cup && m.date.getTime() >= start + 365 * DAY).map((m) => m.date.getTime()))];
  for (const d of cupDays) {
    const past = ms.filter((m) => m.date.getTime() < d);
    const single = fitLeague(past, new Date(d), { halfLifeDays: 90 });
    const pool = fitPool(past, new Date(d), { halfLifeDays: 90, members }).fit;
    for (const m of ms.filter((x) => x.cup && x.date.getTime() === d)) {
      const o = outcomeOf(m.homeGoals, m.awayGoals);
      const outsider = m.homeId.startsWith("o") || m.awayId.startsWith("o");
      for (const [k, fit] of [["single", single], ["pool", pool]] as const) {
        const out = predictFixture({ fit, homeId: m.homeId, awayId: m.awayId, homeName: "", awayName: "", kickoff: m.date,
          restHomeDays: 7, restAwayDays: 7, newsHome: null, newsAway: null, formHome: "", formAway: "" });
        const p: [number, number, number] = [out.raw.home, out.raw.draw, out.raw.away];
        total[k][0] += brier1x2(p, o); total[k][1] += logLoss1x2(p, o); total[k][2] += p.indexOf(Math.max(...p)) === o ? 1 : 0;
        if (outsider) { outs[k][0] += brier1x2(p, o); outs[k][1] += logLoss1x2(p, o); }
      }
      total.n++; if (outsider) outs.n++;
    }
  }
}
const row = (k: "single" | "pool") => console.log(k.padEnd(8), "Brier", (total[k][0] / total.n).toFixed(4), " LogLoss", (total[k][1] / total.n).toFixed(4), " Hit", ((total[k][2] / total.n) * 100).toFixed(1) + "%",
  " | ties with an outsider: Brier", (outs[k][0] / outs.n).toFixed(4), " LogLoss", (outs[k][1] / outs.n).toFixed(4));
console.log(`${total.n} simulated cup ties, ${outs.n} involving a club seen only in the cup (12 seeds, walk-forward)`);
row("single"); row("pool");
