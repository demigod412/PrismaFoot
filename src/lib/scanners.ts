import type { Prediction } from "@prisma/client";

export type Market = "home" | "draw" | "away" | "over15" | "over25" | "over35" | "over45" | "btts" | "under25" | "under35" | "under45";
export interface Pick { market: Market; label: string; p: number }

export interface ScannerFloors { safeP: number; winMargin: number; o15: number; o25: number; btts: number; draw: number; team2: number; u25: number; u35: number; u45: number }
export const DEFAULT_FLOORS: ScannerFloors = { safeP: 0.7, winMargin: 0.1, o15: 0.72, o25: 0.55, btts: 0.55, draw: 0.3, team2: 0.45, u25: 0.55, u35: 0.72, u45: 0.85 };

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
  { slug: "draw", name: "Draw", blurb: "Draws priced above your floor. Draws are rarely favourites; this list is for context." },
  { slug: "safe", name: "Safe", blurb: "High confidence and a single market at or above your safe floor. Not a guarantee. Under 4.5 is left out because it would top almost every match." },
  { slug: "team2", name: "Team 2+ goals", blurb: "One side expected to score two or more, from the scoreline matrix." },
  { slug: "blend", name: "Blend", blurb: "Pick legs yourself. Combined probability assumes independence." },
] as const;
export type ScannerSlug = (typeof SCANNERS)[number]["slug"];

export const MARKET_LABEL: Record<Market, string> = {
  home: "Home win", draw: "Draw", away: "Away win", over15: "Over 1.5", over25: "Over 2.5", over35: "Over 3.5", over45: "Over 4.5", btts: "BTTS", under25: "Under 2.5", under35: "Under 3.5", under45: "Under 4.5",
};

export function marketP(p: Prediction, m: Market): number {
  switch (m) {
    case "home": return p.calHome; case "draw": return p.calDraw; case "away": return p.calAway;
    case "over15": return p.calOver15; case "over25": return p.calOver25; case "over35": return p.calOver35;
    case "over45": return p.calOver45;
    case "btts": return p.calBtts;
    case "under25": return 1 - p.calOver25; case "under35": return 1 - p.calOver35; case "under45": return 1 - p.calOver45;
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
    case "blend": return oneXTwoPick(p);
  }
}
