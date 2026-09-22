import type { Prediction } from "@prisma/client";

/** Every market the app offers (no correct score). All come from calibrated model probabilities. */
export type MarketKey =
  | "home" | "draw" | "away"
  | "dc_1x" | "dc_x2" | "dc_12"
  | "over15" | "over25" | "over35" | "under25" | "under35" | "under45"
  | "btts_yes" | "btts_no"
  | "home_by2" | "away_by2"
  | "corners_over" | "corners_under"
  | "shots_over" | "shots_under";

export type MarketGroup = "win" | "dc" | "goals" | "btts" | "hcp" | "corners" | "shots";
export const GROUP_LABEL: Record<MarketGroup, string> = {
  win: "Win", dc: "Double chance", goals: "Goals O/U", btts: "Both teams to score", hcp: "2-goal handicap", corners: "Corners", shots: "Total shots",
};

export interface MarketTip { key: MarketKey; group: MarketGroup; label: string; short: string; p: number }

/** All markets for one match. Corners/shots only when the model has enough stats history. */
export function allMarkets(p: Prediction, home: string, away: string): MarketTip[] {
  const out: MarketTip[] = [
    { key: "home", group: "win", label: `${home} to win`, short: "Home win", p: p.calHome },
    { key: "away", group: "win", label: `${away} to win`, short: "Away win", p: p.calAway },
    { key: "draw", group: "win", label: "Draw", short: "Draw", p: p.calDraw },
    { key: "dc_1x", group: "dc", label: `${home} or draw (1X)`, short: "1X", p: p.calHome + p.calDraw },
    { key: "dc_x2", group: "dc", label: `Draw or ${away} (X2)`, short: "X2", p: p.calDraw + p.calAway },
    { key: "dc_12", group: "dc", label: `${home} or ${away} (12)`, short: "12", p: p.calHome + p.calAway },
    { key: "over15", group: "goals", label: "Over 1.5 goals", short: "O1.5", p: p.calOver15 },
    { key: "over25", group: "goals", label: "Over 2.5 goals", short: "O2.5", p: p.calOver25 },
    { key: "over35", group: "goals", label: "Over 3.5 goals", short: "O3.5", p: p.calOver35 },
    { key: "under25", group: "goals", label: "Under 2.5 goals", short: "U2.5", p: 1 - p.calOver25 },
    { key: "under35", group: "goals", label: "Under 3.5 goals", short: "U3.5", p: 1 - p.calOver35 },
    { key: "under45", group: "goals", label: "Under 4.5 goals", short: "U4.5", p: 1 - p.calOver45 },
    { key: "btts_yes", group: "btts", label: "Both teams to score", short: "BTTS Yes", p: p.calBtts },
    { key: "btts_no", group: "btts", label: "Both teams to score: No", short: "BTTS No", p: 1 - p.calBtts },
  ];
  if (p.calHomeBy2 != null && p.calAwayBy2 != null) out.push(
    { key: "home_by2", group: "hcp", label: `${home} to win by 2+ goals (−1.5)`, short: "Home −1.5", p: p.calHomeBy2 },
    { key: "away_by2", group: "hcp", label: `${away} to win by 2+ goals (−1.5)`, short: "Away −1.5", p: p.calAwayBy2 },
  );
  if (p.calCornersOver != null && p.cornersLine != null) out.push(
    { key: "corners_over", group: "corners", label: `Over ${p.cornersLine} corners`, short: `Corners O${p.cornersLine}`, p: p.calCornersOver },
    { key: "corners_under", group: "corners", label: `Under ${p.cornersLine} corners`, short: `Corners U${p.cornersLine}`, p: 1 - p.calCornersOver },
  );
  if (p.calShotsOver != null && p.shotsLine != null) out.push(
    { key: "shots_over", group: "shots", label: `Over ${p.shotsLine} total shots`, short: `Shots O${p.shotsLine}`, p: p.calShotsOver },
    { key: "shots_under", group: "shots", label: `Under ${p.shotsLine} total shots`, short: `Shots U${p.shotsLine}`, p: 1 - p.calShotsOver },
  );
  return out;
}

export interface MatchResult { h: number; a: number; hc?: number | null; ac?: number | null; hs?: number | null; as?: number | null }

/** true/false = hit/miss; null = can't be scored (no corner/shot data). */
export function marketHit(k: MarketKey, r: MatchResult, lines: { corners?: number | null; shots?: number | null } = {}): boolean | null {
  const { h, a } = r, t = h + a;
  switch (k) {
    case "home": return h > a; case "away": return a > h; case "draw": return h === a;
    case "dc_1x": return h >= a; case "dc_x2": return a >= h; case "dc_12": return h !== a;
    case "over15": return t >= 2; case "over25": return t >= 3; case "over35": return t >= 4;
    case "under25": return t <= 2; case "under35": return t <= 3; case "under45": return t <= 4;
    case "btts_yes": return h > 0 && a > 0; case "btts_no": return h === 0 || a === 0;
    case "home_by2": return h - a >= 2; case "away_by2": return a - h >= 2;
    case "corners_over": case "corners_under": {
      if (r.hc == null || r.ac == null || lines.corners == null) return null;
      return k === "corners_over" ? r.hc + r.ac > lines.corners : r.hc + r.ac < lines.corners;
    }
    case "shots_over": case "shots_under": {
      if (r.hs == null || r.as == null || lines.shots == null) return null;
      return k === "shots_over" ? r.hs + r.as > lines.shots : r.hs + r.as < lines.shots;
    }
  }
}
