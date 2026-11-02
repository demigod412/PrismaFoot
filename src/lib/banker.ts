import { buildSlips, type Candidate } from "./builder";
import { marketHit, type MarketKey, type MatchResult } from "./markets";

/*
 * The daily rollover banker.
 *
 *   1.74 with at least 6 legs, rolled over four times
 *   2.25 with at least 8 legs, played every day
 *   game of the day: the single safest pick priced 1.20-1.60
 *
 * Each is chosen once per day and then FIXED (see DailyBanker): a slip you booked in the morning must not
 * change under you when a later sync moves a probability or a match kicks off.
 *
 * The honest arithmetic: at a fixed total price, more legs never raise the chance — each leg adds a little
 * bookmaker margin and a little correlation. What a leg minimum buys is SHORTER legs (1.74 over six is about
 * 1.10 a leg, ~90% each), which is what a rollover banker is meant to feel like. The chance of the slip is
 * still roughly 1 / price plus whatever edge the model has over the bookmaker.
 */
export interface BankerConfig { target: number; minLegs: number; maxLegs: number; label: string; plan: string; steps: number }
export const BANKERS: BankerConfig[] = [
  { target: 1.74, minLegs: 6, maxLegs: 9, label: "1.74 banker", plan: "rolled over four times a week", steps: 4 },
  { target: 2.25, minLegs: 8, maxLegs: 11, label: "2.25 banker", plan: "played every day", steps: 4 },
];
/** The game of the day is stored as a one-leg banker under this target. */
export const GOTD_TARGET = 1;

/**
 * Markets a banker may use: ones Sportybet books as a single selection and that settle from the score.
 * Corners, shots and tackles are left out — their lines vary by bookmaker, so the line we price is often
 * not the line on offer — and so are the combined "win or over" markets, which no book offers as one pick.
 */
export const BANKER_MARKETS: ReadonlySet<string> = new Set<MarketKey>([
  "home", "away", "dc_1x", "dc_x2", "dc_12",
  "over15", "over25", "under25", "under35", "under45",
  "btts_yes", "btts_no", "no_gg2",
  "home_by2", "away_by2",
  "h1_under15", "h1_under25", "h2_under25",
]);

/** Never a single leg above this in a banker: a banker is many short prices, not one risky one. */
export const BANKER_MAX_LEG_ODDS = 1.45;

/** Two-way bookmaker markets carry about this much margin: 1/odds over-states the chance by ~5%. */
export const OVERROUND = 1.05;
/** Weight on the model when a bookmaker price exists; the rest goes to the price's implied chance. */
export const MODEL_WEIGHT = 0.5;

/**
 * The chance and price a banker leg is judged on.
 *
 * Priced legs: the model's probability blended 50/50 with the bookmaker's (margin removed). Choosing the
 * legs where the model is most above the bookmaker otherwise selects the model's own errors — in the
 * simulation (`npm run backtest:banker`) the raw model claimed ~75% for slips that landed ~50% of the time;
 * blended, the claim sits within a few points of what happens.
 *
 * Unpriced legs: the probability stands, but the price is what a bookmaker would actually pay, about
 * 1 / (p × 1.06), not the fair 1 / p. Otherwise an unpriced leg looks margin-free and the search prefers
 * legs whose real Sportybet price will come in shorter than the slip promised.
 */
export function bankerView(c: Candidate): Candidate {
  if (c.real) return { ...c, p: MODEL_WEIGHT * c.p + (1 - MODEL_WEIGHT) * Math.min(0.99, 1 / (c.odds * OVERROUND)) };
  return { ...c, odds: Math.max(1.01, 1 / (c.p * (OVERROUND + 0.01))) };
}

export const bankerPool = (cands: Candidate[]) => cands.filter((c) => BANKER_MARKETS.has(c.market) && c.band !== "LOW" && !c.unverifiable).map(bankerView);

/**
 * Trim a busy day's pool before the search: at most 3 markets per match and 150 overall, preferring the
 * safe-mode rank (probability per unit of price, trust-weighted) and then legs priced near the even share
 * of the target. A Saturday with 400 fixtures otherwise hands the beam search thousands of legs.
 */
export function trimPool(cands: Candidate[], cfg: BankerConfig, perMatch = 3, total = 150) {
  const ideal = Math.log(Math.pow(cfg.target, 1 / cfg.minLegs));
  const rank = (c: Candidate) => Math.log(c.p * (c.trust ?? 1)) / Math.log(c.odds);
  const near = (c: Candidate) => Math.abs(Math.log(c.odds) - ideal);
  const order = (a: Candidate, b: Candidate) => rank(b) - rank(a) || near(a) - near(b);
  const by = new Map<string, Candidate[]>();
  for (const c of bankerPool(cands).filter((c) => c.odds > 1.01 && c.odds <= BANKER_MAX_LEG_ODDS).sort(order)) {
    const rows = by.get(c.matchId) ?? [];
    if (rows.length < perMatch) { rows.push(c); by.set(c.matchId, rows); }
  }
  return [...by.values()].flat().sort(order).slice(0, total);
}

/** The safest slip reaching `cfg.target` with at least `cfg.minLegs` legs, or null when the day can't make one. */
export function pickBanker(cands: Candidate[], cfg: BankerConfig) {
  const [best] = buildSlips(trimPool(cands, cfg), {
    target: cfg.target, minLegs: cfg.minLegs, maxLegs: cfg.maxLegs, mode: "safe", band: "LOW",
    maxLegOdds: BANKER_MAX_LEG_ODDS, evenLegs: true, overshoot: 1.06, maxPerGroup: 3,
  }, 3);
  return best && best.legs.length >= cfg.minLegs ? best : null;
}

/**
 * The single safest pick of the day: priced 1.20-1.60 (by the bookmaker where we have a price, otherwise
 * fairly), High confidence preferred, then the highest probability weighted by the ledger's trust.
 */
export function pickGameOfDay(cands: Candidate[]): Candidate | null {
  const pool = bankerPool(cands).filter((c) => c.odds >= 1.2 && c.odds <= 1.6);
  const score = (c: Candidate) => c.p * (c.trust ?? 1);
  return [...pool].sort((a, b) => Number(b.band === "HIGH") - Number(a.band === "HIGH") || score(b) - score(a))[0] ?? null;
}

export interface StoredLeg { fixtureId: string; market: string; label: string; match: string; league: string; kickoff: string; p: number; odds: number; real: boolean }
export type LegState = "won" | "lost" | "void" | "pending";
export type SlipState = "won" | "lost" | "pending";

/** One leg's state from its fixture: postponed or cancelled legs are void (the bookmaker prices them at 1.00). */
export function legState(leg: StoredLeg, fx: { status: string; homeGoals: number | null; awayGoals: number | null; htHome: number | null; htAway: number | null } & Omit<MatchResult, "h" | "a" | "hh" | "ha"> | undefined): LegState {
  if (!fx) return "pending";
  if (fx.status === "CANCELLED" || fx.status === "POSTPONED") return "void";
  if (fx.status !== "FINISHED" || fx.homeGoals == null || fx.awayGoals == null) return "pending";
  const hit = marketHit(leg.market as MarketKey, { ...fx, h: fx.homeGoals, a: fx.awayGoals, hh: fx.htHome, ha: fx.htAway });
  return hit == null ? "pending" : hit ? "won" : "lost";
}

/** A slip loses on its first lost leg, wins once every non-void leg has won. Void legs drop out of the price. */
export function slipState(legs: { odds: number; state: LegState }[]): { state: SlipState; odds: number } {
  const live = legs.filter((l) => l.state !== "void");
  const odds = live.reduce((s, l) => s * l.odds, 1);
  if (live.some((l) => l.state === "lost")) return { state: "lost", odds };
  if (live.some((l) => l.state === "pending")) return { state: "pending", odds };
  return { state: "won", odds };
}

/**
 * Rollover chains over a run of daily results, oldest first: each win rolls the stake onto the next day,
 * `steps` wins in a row cash the chain out, a loss busts it and the next day starts a fresh one.
 * Pending days end the series (they have not happened yet).
 */
export function rolloverChains(days: { day: string; state: SlipState; odds: number }[], steps: number) {
  const chains: { start: string; end: string; reached: number; done: boolean; multiplier: number }[] = [];
  let cur: { start: string; end: string; reached: number; multiplier: number } | null = null;
  for (const d of days) {
    if (d.state === "pending") break;
    cur ??= { start: d.day, end: d.day, reached: 0, multiplier: 1 };
    cur.end = d.day;
    if (d.state === "won") {
      cur.reached++; cur.multiplier *= d.odds;
      if (cur.reached >= steps) { chains.push({ ...cur, done: true }); cur = null; }
    } else { chains.push({ ...cur, done: false }); cur = null; }
  }
  return { chains, open: cur, completed: chains.filter((c) => c.done).length, busted: chains.filter((c) => !c.done).length };
}

/** Longest and current run of winning days, oldest first. */
export function streaks(days: { state: SlipState }[]) {
  let best = 0, run = 0;
  for (const d of days) { if (d.state === "pending") break; run = d.state === "won" ? run + 1 : 0; best = Math.max(best, run); }
  return { best, current: run };
}
