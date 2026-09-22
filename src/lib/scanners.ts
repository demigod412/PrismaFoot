import type { Prediction } from "@prisma/client";
import { allMarkets, type MarketKey, type MarketTip } from "./markets";

export type Market = MarketKey | "btts";
export interface Pick { market: Market; label: string; p: number }

export interface ScannerFloors { safeP: number; winMargin: number; o15: number; o25: number; btts: number; draw: number; team2: number; u25: number; u35: number; u45: number; dc: number; bttsNo: number; by2: number; corners: number; shots: number; h1u15: number; h1u25: number; h2u25: number; winOver: number; htDraw: number }
export const DEFAULT_FLOORS: ScannerFloors = { safeP: 0.7, winMargin: 0.1, o15: 0.72, o25: 0.55, btts: 0.55, draw: 0.3, team2: 0.45, u25: 0.55, u35: 0.72, u45: 0.85, dc: 0.75, bttsNo: 0.55, by2: 0.4, corners: 0.6, shots: 0.6, h1u15: 0.6, h1u25: 0.78, h2u25: 0.7, winOver: 0.7, htDraw: 0.3 };

export const SCANNERS = [
  { slug: "all", name: "All", blurb: "Every fixture with a model call, ordered by kickoff." },
  { slug: "win", name: "Win", blurb: "Most-likely 1X2 outcome, Medium or High confidence, clear margin over the next outcome." },
  { slug: "1plus", name: "1+", blurb: "Home or away side to score at least once." },
  { slug: "2plus", name: "2+", blurb: "Two or more total goals (same as Over 1.5)." },
  { slug: "o15", name: "O1.5", blurb: "Over 1.5 goals above your floor." },
  { slug: "o25", name: "O2.5", blurb: "Over 2.5 goals above your floor." },
  { slug: "btts", name: "BTTS", blurb: "Both teams to score above your floor." },
  { slug: "u25", name: "U2.5", blurb: "Under 2.5 goals (0, 1 or 2 total) above your floor." },
  { slug: "u35", name: "U3.5", blurb: "Under 3.5 goals (3 or fewer) above your floor." },
  { slug: "u45", name: "U4.5", blurb: "Under 4.5 goals (4 or fewer) above your floor. Most matches land here, so the floor is set high." },
  { slug: "dc", name: "Double chance", blurb: "Best of 1X, X2 or 12 for each match, above your floor." },
  { slug: "bttsno", name: "BTTS No", blurb: "At least one side fails to score, above your floor." },
  { slug: "by2", name: "Win by 2+", blurb: "A side to win by two or more goals (handicap −1.5), above your floor." },
  { slug: "corners", name: "Corners", blurb: "Corners at this fixture's own line: the strongest offered line, over or under, above your floor. Needs match statistics (API-Football)." },
  { slug: "shots", name: "Shots", blurb: "Total shots at this fixture's own line, over or under, above your floor. Needs match statistics (API-Football)." },
  { slug: "htdraw", name: "HT draw", blurb: "Draw at half-time, above your floor. Half-time draws land in roughly one match in four." },
  { slug: "h1u15", name: "1H U1.5", blurb: "First half Under 1.5 goals (0 or 1 goal before half-time), above your floor." },
  { slug: "h1u25", name: "1H U2.5", blurb: "First half Under 2.5 goals, above your floor. Most first halves land here, so the floor is set high." },
  { slug: "h2u25", name: "2H U2.5", blurb: "Second half Under 2.5 goals, above your floor." },
  { slug: "winover", name: "Win or O2.5", blurb: "A side to win OR the match to have 3+ goals (either one lands the tip), above your floor." },
  { slug: "draw", name: "Draw", blurb: "Draws priced above your floor. Draws are rarely favourites; this list is for context." },
  { slug: "safe", name: "Safe", blurb: "High confidence and a single market at or above your safe floor. Not a guarantee. Under 4.5 is left out because it would top almost every match." },
  { slug: "team2", name: "Team 2+ goals", blurb: "One side expected to score two or more, from the scoreline matrix." },
  { slug: "blend", name: "Blend", blurb: "Pick legs yourself. Combined probability assumes independence." },
] as const;
export type ScannerSlug = (typeof SCANNERS)[number]["slug"];

export const MARKET_LABEL: Partial<Record<Market, string>> & Record<string, string> = {
  home: "Home win", draw: "Draw", away: "Away win", over15: "Over 1.5", over25: "Over 2.5", over35: "Over 3.5", over45: "Over 4.5", btts: "BTTS", under25: "Under 2.5", under35: "Under 3.5", under45: "Under 4.5",
  dc_1x: "1X", dc_x2: "X2", dc_12: "12", btts_no: "BTTS No", home_by2: "Home −1.5", away_by2: "Away −1.5",
  corners_over: "Corners Over 8.5", corners_under: "Corners Under 8.5", shots_over: "Shots Over 24.5", shots_under: "Shots Under 24.5",
  h1_under15: "1H Under 1.5", h1_under25: "1H Under 2.5", h2_under25: "2H Under 2.5", home_or_over25: "Home or Over 2.5", away_or_over25: "Away or Over 2.5", ht_draw: "HT draw",
};
/** Label for any market key, including per-fixture corner / shot lines ("corners_over@10.5"). */
export const labelOf = (m: Market) => MARKET_LABEL[m as keyof typeof MARKET_LABEL] ?? String(m).replace(/^(corners|shots)_(over|under)@/, (_x, b: string, s: string) => `${b[0].toUpperCase()}${b.slice(1)} ${s === "over" ? "Over" : "Under"} `);

export function marketP(p: Prediction, m: Market): number {
  const dyn = allMarkets(p, "Home", "Away").find((x) => x.key === m);
  if (dyn) return dyn.p;
  switch (m) {
    case "home": return p.calHome; case "draw": return p.calDraw; case "away": return p.calAway;
    case "over15": return p.calOver15; case "over25": return p.calOver25; case "over35": return p.calOver35;
    case "btts": return p.calBtts;
    case "under25": return 1 - p.calOver25; case "under35": return 1 - p.calOver35; case "under45": return 1 - p.calOver45;
    case "dc_1x": return p.calHome + p.calDraw; case "dc_x2": return p.calDraw + p.calAway; case "dc_12": return p.calHome + p.calAway;
    case "btts_no": return 1 - p.calBtts;
    case "home_by2": return p.calHomeBy2 ?? 0; case "away_by2": return p.calAwayBy2 ?? 0;
    case "corners_over": return p.calCornersOver ?? 0; case "corners_under": return p.calCornersOver == null ? 0 : 1 - p.calCornersOver;
    case "shots_over": return p.calShotsOver ?? 0; case "shots_under": return p.calShotsOver == null ? 0 : 1 - p.calShotsOver;
    default: return 0;
    case "h1_under15": return p.calH1Under15 ?? 0; case "h1_under25": return p.calH1Under25 ?? 0; case "h2_under25": return p.calH2Under25 ?? 0;
    case "ht_draw": return p.calHtDraw ?? 0;
    case "home_or_over25": return p.calHomeOrOver25 ?? 0; case "away_or_over25": return p.calAwayOrOver25 ?? 0;
  }
}

/** P(team scores ≥ k) from the stored matrix (rows = home goals). */
export function teamAtLeast(matrix: number[][], side: "home" | "away", k: number): number {
  let s = 0;
  matrix.forEach((row, i) => row.forEach((p, j) => { if ((side === "home" ? i : j) >= k) s += p; }));
  return Math.min(1, s);
}

export function oneXTwoPick(p: Prediction): Pick & { margin: number } {
  const arr: Pick[] = [
    { market: "home", label: "Home", p: p.calHome }, { market: "draw", label: "Draw", p: p.calDraw }, { market: "away", label: "Away", p: p.calAway },
  ].sort((a, b) => b.p - a.p) as Pick[];
  return { ...arr[0], margin: arr[0].p - arr[1].p };
}

/** Returns the pick a scanner surfaces for a prediction, or null if it doesn't qualify. */
export function scan(slug: ScannerSlug, p: Prediction, f: ScannerFloors): Pick | null {
  const m = p.matrix as number[][];
  switch (slug) {
    case "all": { const x = oneXTwoPick(p); return x; }
    case "win": { const x = oneXTwoPick(p); return x.market !== "draw" && p.band !== "LOW" && x.margin >= f.winMargin ? x : null; }
    case "1plus": { const h = teamAtLeast(m, "home", 1), a = teamAtLeast(m, "away", 1);
      return h >= a ? { market: "home", label: "Home 1+", p: h } : { market: "away", label: "Away 1+", p: a }; }
    case "2plus": case "o15": return p.calOver15 >= f.o15 ? { market: "over15", label: slug === "2plus" ? "2+ goals" : "Over 1.5", p: p.calOver15 } : null;
    case "o25": return p.calOver25 >= f.o25 ? { market: "over25", label: "Over 2.5", p: p.calOver25 } : null;
    case "btts": return p.calBtts >= f.btts ? { market: "btts", label: "BTTS", p: p.calBtts } : null;
    case "u25": return 1 - p.calOver25 >= f.u25 ? { market: "under25", label: "Under 2.5", p: 1 - p.calOver25 } : null;
    case "u35": return 1 - p.calOver35 >= f.u35 ? { market: "under35", label: "Under 3.5", p: 1 - p.calOver35 } : null;
    case "u45": return 1 - p.calOver45 >= f.u45 ? { market: "under45", label: "Under 4.5", p: 1 - p.calOver45 } : null;
    case "draw": return p.calDraw >= f.draw ? { market: "draw", label: "Draw", p: p.calDraw } : null;
    case "dc": {
      const b = ([["dc_1x", "1X (home or draw)"], ["dc_x2", "X2 (draw or away)"], ["dc_12", "12 (no draw)"]] as const).map(([m, label]) => ({ market: m as Market, label, p: marketP(p, m) })).sort((x, y) => y.p - x.p)[0];
      return b.p >= f.dc ? b : null;
    }
    case "bttsno": return 1 - p.calBtts >= f.bttsNo ? { market: "btts_no", label: "BTTS No", p: 1 - p.calBtts } : null;
    case "by2": {
      if (p.calHomeBy2 == null || p.calAwayBy2 == null) return null;
      const b = p.calHomeBy2 >= p.calAwayBy2 ? { market: "home_by2" as Market, label: "Home to win by 2+", p: p.calHomeBy2 } : { market: "away_by2" as Market, label: "Away to win by 2+", p: p.calAwayBy2 };
      return b.p >= f.by2 ? b : null;
    }
    case "corners": case "shots": {
      const g = slug === "corners" ? "corners" : "shots";
      const rows = allMarkets(p, "Home", "Away").filter((x) => x.group === g);
      if (!rows.length) return null;
      const b = (rows.find((x) => x.strong) ?? rows.filter((x) => x.main).sort((x, y) => y.p - x.p)[0]) as MarketTip;
      const floor = slug === "corners" ? f.corners : f.shots;
      return b && b.p >= floor ? { market: b.key, label: b.short, p: b.p } : null;
    }
    case "htdraw": return p.calHtDraw != null && p.calHtDraw >= f.htDraw ? { market: "ht_draw", label: "Draw at half-time", p: p.calHtDraw } : null;
    case "team2": { const h = teamAtLeast(m, "home", 2), a = teamAtLeast(m, "away", 2);
      const best = h >= a ? { market: "home" as Market, label: "Home 2+ goals", p: h } : { market: "away" as Market, label: "Away 2+ goals", p: a };
      return best.p >= f.team2 ? best : null; }
    case "safe": {
      if (p.band !== "HIGH") return null;
      const cands: Pick[] = [
        { market: "home", label: "Home win", p: p.calHome }, { market: "away", label: "Away win", p: p.calAway },
        { market: "over15", label: "Over 1.5", p: p.calOver15 }, { market: "under25", label: "Under 2.5", p: 1 - p.calOver25 },
        { market: "under35", label: "Under 3.5", p: 1 - p.calOver35 }, { market: "btts", label: "BTTS", p: p.calBtts },
      ];
      const best = cands.sort((a, b) => b.p - a.p)[0];
      return best.p >= f.safeP ? best : null;
    }
    case "h1u15": return p.calH1Under15 != null && p.calH1Under15 >= f.h1u15 ? { market: "h1_under15", label: "1H Under 1.5", p: p.calH1Under15 } : null;
    case "h1u25": return p.calH1Under25 != null && p.calH1Under25 >= f.h1u25 ? { market: "h1_under25", label: "1H Under 2.5", p: p.calH1Under25 } : null;
    case "h2u25": return p.calH2Under25 != null && p.calH2Under25 >= f.h2u25 ? { market: "h2_under25", label: "2H Under 2.5", p: p.calH2Under25 } : null;
    case "winover": {
      if (p.calHomeOrOver25 == null || p.calAwayOrOver25 == null) return null;
      const b = p.calHomeOrOver25 >= p.calAwayOrOver25 ? { market: "home_or_over25" as Market, label: "Home win or Over 2.5", p: p.calHomeOrOver25 } : { market: "away_or_over25" as Market, label: "Away win or Over 2.5", p: p.calAwayOrOver25 };
      return b.p >= f.winOver ? b : null;
    }
    case "blend": return oneXTwoPick(p);
  }
}
