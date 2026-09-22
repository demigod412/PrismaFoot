import type { Prediction } from "@prisma/client";

/** Every market the app offers (no correct score). All come from calibrated model probabilities. */
export type MarketKey =
  | "home" | "draw" | "away"
  | "dc_1x" | "dc_x2" | "dc_12"
  | "over15" | "over25" | "over35" | "under25" | "under35" | "under45"
  | "btts_yes" | "btts_no"
  | "home_by2" | "away_by2"
  | "corners_over" | "corners_under"   // legacy fixed-line keys (older predictions)
  | "shots_over" | "shots_under"
  | `corners_over@${number}` | `corners_under@${number}` | `shots_over@${number}` | `shots_under@${number}`
  | "ht_draw"
  | "h1_under15" | "h1_under25" | "h2_under25"
  | "home_or_over25" | "away_or_over25";

export type MarketGroup = "win" | "dc" | "goals" | "btts" | "hcp" | "halves" | "combo" | "corners" | "shots";
export const GROUP_LABEL: Record<MarketGroup, string> = {
  win: "Win", dc: "Double chance", goals: "Goals O/U", btts: "Both teams to score", hcp: "2-goal handicap", halves: "Halves", combo: "Win or Over 2.5", corners: "Corners", shots: "Total shots",
};

export interface MarketTip { key: MarketKey; group: MarketGroup; label: string; short: string; p: number; line?: number; main?: boolean; strong?: boolean; alt?: boolean }

/** Corner / shot lines are per fixture, so the line travels in the key: "corners_over@10.5". */
export const lineKey = (base: "corners" | "shots", side: "over" | "under", line: number) => `${base}_${side}@${line}` as MarketKey;
export const parseLineKey = (k: string) => { const m = /^(corners|shots)_(over|under)@(-?\d+(?:\.\d+)?)$/.exec(k); return m ? { base: m[1] as "corners" | "shots", side: m[2] as "over" | "under", line: Number(m[3]) } : null; };
const STRONG_FLOOR = 0.65;
type LadderRow = { l: number; o: number };
const ladderOf = (v: unknown): LadderRow[] => (Array.isArray(v) ? (v as LadderRow[]).filter((r) => typeof r?.l === "number" && typeof r?.o === "number") : []);

/** Offered lines for corners / shots: Over and Under on each, with the main line and the strong line flagged. */
function lineMarkets(base: "corners" | "shots", rows: LadderRow[], main: number | null, unit: string, group: MarketGroup): MarketTip[] {
  if (!rows.length) return [];
  const mainRow = rows.find((r) => r.l === main) ?? rows[Math.floor(rows.length / 2)];
  const lean: "over" | "under" = mainRow.o >= 0.5 ? "over" : "under";
  const strong = lean === "over"
    ? rows.filter((r) => r.o >= STRONG_FLOOR).sort((a, b) => b.l - a.l)[0]
    : rows.filter((r) => 1 - r.o >= STRONG_FLOOR).sort((a, b) => a.l - b.l)[0];
  return rows.flatMap((r) => (["over", "under"] as const).map((side) => ({
    key: lineKey(base, side, r.l), group, line: r.l,
    label: `${side === "over" ? "Over" : "Under"} ${r.l} ${unit}`, short: `${unit === "corners" ? "Corners" : "Shots"} ${side === "over" ? "O" : "U"}${r.l}`,
    p: side === "over" ? r.o : 1 - r.o,
    ...(r.l === mainRow.l ? { main: true } : { alt: true }),
    ...(strong && strong.l === r.l && side === lean ? { strong: true } : {}),
  })));
}

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
  if (p.calH1Under15 != null && p.calH1Under25 != null && p.calH2Under25 != null) out.push(
    { key: "h1_under15", group: "halves", label: "1st half Under 1.5 goals", short: "1H U1.5", p: p.calH1Under15 },
    { key: "h1_under25", group: "halves", label: "1st half Under 2.5 goals", short: "1H U2.5", p: p.calH1Under25 },
    { key: "h2_under25", group: "halves", label: "2nd half Under 2.5 goals", short: "2H U2.5", p: p.calH2Under25 },
  );
  if (p.calHomeOrOver25 != null && p.calAwayOrOver25 != null) out.push(
    { key: "home_or_over25", group: "combo", label: `${home} win or Over 2.5 goals`, short: "Home or O2.5", p: p.calHomeOrOver25 },
    { key: "away_or_over25", group: "combo", label: `${away} win or Over 2.5 goals`, short: "Away or O2.5", p: p.calAwayOrOver25 },
  );
  if (p.calHtDraw != null) out.push({ key: "ht_draw", group: "halves", label: "Draw at half-time", short: "HT draw", p: p.calHtDraw });
  const cRows = ladderOf(p.cornerLines), sRows = ladderOf(p.shotLines);
  if (cRows.length) out.push(...lineMarkets("corners", cRows, p.cornersLine, "corners", "corners"));
  else if (p.calCornersOver != null && p.cornersLine != null) out.push( // older predictions: the old fixed line
    { key: "corners_over", group: "corners", label: `Over ${p.cornersLine} corners`, short: `Corners O${p.cornersLine}`, p: p.calCornersOver, line: p.cornersLine, main: true },
    { key: "corners_under", group: "corners", label: `Under ${p.cornersLine} corners`, short: `Corners U${p.cornersLine}`, p: 1 - p.calCornersOver, line: p.cornersLine, main: true },
  );
  if (sRows.length) out.push(...lineMarkets("shots", sRows, p.shotsLine, "shots", "shots"));
  else if (p.calShotsOver != null && p.shotsLine != null) out.push(
    { key: "shots_over", group: "shots", label: `Over ${p.shotsLine} total shots`, short: `Shots O${p.shotsLine}`, p: p.calShotsOver, line: p.shotsLine, main: true },
    { key: "shots_under", group: "shots", label: `Under ${p.shotsLine} total shots`, short: `Shots U${p.shotsLine}`, p: 1 - p.calShotsOver, line: p.shotsLine, main: true },
  );
  return out;
}

export interface MatchResult { h: number; a: number; hc?: number | null; ac?: number | null; hs?: number | null; as?: number | null; hh?: number | null; ha?: number | null /* half-time */ }

/** true/false = hit/miss; null = can't be scored (no corner/shot/half-time data). */
export function marketHit(k: MarketKey, r: MatchResult, lines: { corners?: number | null; shots?: number | null } = {}): boolean | null {
  const { h, a } = r, t = h + a;
  const onLine = parseLineKey(k);
  if (onLine) {
    const [x, y] = onLine.base === "corners" ? [r.hc, r.ac] : [r.hs, r.as];
    if (x == null || y == null) return null;
    return onLine.side === "over" ? x + y > onLine.line : x + y < onLine.line;
  }
  switch (k) {
    case "ht_draw": return r.hh == null || r.ha == null ? null : r.hh === r.ha;
    case "home": return h > a; case "away": return a > h; case "draw": return h === a;
    case "dc_1x": return h >= a; case "dc_x2": return a >= h; case "dc_12": return h !== a;
    case "over15": return t >= 2; case "over25": return t >= 3; case "over35": return t >= 4;
    case "under25": return t <= 2; case "under35": return t <= 3; case "under45": return t <= 4;
    case "btts_yes": return h > 0 && a > 0; case "btts_no": return h === 0 || a === 0;
    case "home_by2": return h - a >= 2; case "away_by2": return a - h >= 2;
    case "home_or_over25": return h > a || t >= 3; case "away_or_over25": return a > h || t >= 3;
    case "h1_under15": case "h1_under25": case "h2_under25": {
      if (r.hh == null || r.ha == null) return null; // no half-time score stored
      const h1 = r.hh + r.ha, h2 = t - h1;
      return k === "h1_under15" ? h1 <= 1 : k === "h1_under25" ? h1 <= 2 : h2 <= 2;
    }
    case "corners_over": case "corners_under": {
      if (r.hc == null || r.ac == null || lines.corners == null) return null;
      return k === "corners_over" ? r.hc + r.ac > lines.corners : r.hc + r.ac < lines.corners;
    }
    case "shots_over": case "shots_under": {
      if (r.hs == null || r.as == null || lines.shots == null) return null;
      return k === "shots_over" ? r.hs + r.as > lines.shots : r.hs + r.as < lines.shots;
    }
  }
  return null; // template-literal line keys are handled above
}
