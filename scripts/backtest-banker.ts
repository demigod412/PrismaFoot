/**
 * The daily banker on simulated days (no DB): how often a 1.74 / 2.25 slip lands, and what the leg minimum
 * does to that once a bookmaker margin is in the prices.
 *
 * Each simulated day has 60 fixtures with 18 bookable markets each. Every market has a TRUE probability;
 * the model sees it with noise; the bookmaker prices it with a 5% margin and its own noise. The slip is
 * picked exactly as the app picks it (pickBanker), then settled against the true probabilities.
 * Run: npm run backtest:banker
 */
import { BANKERS, pickBanker, type BankerConfig } from "../src/lib/banker";
import type { Candidate } from "../src/lib/builder";
import { makeRng } from "../src/lib/demo/rng";

const rng = makeRng(11);
const MARKETS = ["home", "away", "dc_1x", "dc_x2", "dc_12", "over15", "over25", "under25", "under35", "under45", "btts_yes", "btts_no", "no_gg2", "home_by2", "away_by2", "h1_under15", "h1_under25", "h2_under25"];
const clamp = (x: number) => Math.min(0.985, Math.max(0.03, x));
const normal = () => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());

function day(): { cands: Candidate[]; truth: Map<string, number> } {
  const cands: Candidate[] = [], truth = new Map<string, number>();
  for (let f = 0; f < 60; f++) for (const m of MARKETS) {
    const t = clamp(0.1 + 0.88 * rng() ** 0.6);                      // plenty of short-priced markets, like real days
    const model = clamp(t + normal() * 0.04);                         // model error
    const book = 1 / clamp(t * 1.05 + normal() * 0.02);               // 5% margin + bookmaker noise
    const key = `f${f}:${m}`;
    truth.set(key, t);
    cands.push({ matchId: `f${f}`, league: `L${f % 12}`, startMs: f, match: `f${f}`, label: m, market: m, group: m.split("_")[0], p: model, odds: book, real: true, band: "HIGH" });
  }
  return { cands, truth };
}

const DAYS = Number(process.env.DAYS) || 1500;
const configs: BankerConfig[] = [
  ...BANKERS,
  { ...BANKERS[0], minLegs: 3, maxLegs: 6, label: "1.74 with 3+ legs" },
  { ...BANKERS[1], minLegs: 4, maxLegs: 7, label: "2.25 with 4+ legs" },
];
const t0 = Date.now();
for (const cfg of configs) {
  let n = 0, won = 0, sumP = 0, sumOdds = 0, legs = 0;
  const local = makeRng(99);
  for (let d = 0; d < DAYS; d++) {
    const { cands, truth } = day();
    const slip = pickBanker(cands, cfg);
    if (!slip) continue;
    n++; sumP += slip.p; sumOdds += slip.odds; legs += slip.legs.length;
    if (slip.legs.every((l) => local() < truth.get(`${l.matchId}:${l.market}`)!)) won++;
  }
  const chain4 = Math.pow(won / n, 4);
  console.log(`${cfg.label.padEnd(20)} ${n} days · avg ${(legs / n).toFixed(1)} legs @ ${(sumOdds / n).toFixed(2)} · banker says ${(sumP / n * 100).toFixed(1)}% · actually won ${(won / n * 100).toFixed(1)}% · 4 in a row ≈ ${(chain4 * 100).toFixed(1)}%`);
}
console.log(`(${((Date.now() - t0) / 1000 / (DAYS * configs.length) * 1000).toFixed(0)} ms per slip search)`);
