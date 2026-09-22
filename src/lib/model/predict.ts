import { LOW_BAND_DISPLAY_CAP, MODEL_VERSION } from "./constants";
import { marketsFromMatrix, scoreMatrix, topScorelines, truncateMatrix, winByAtLeast, type Markets, type Scoreline } from "./dixonColes";
import { priorRating, type LeagueFit, type TeamRating } from "./ratings";
import { apply, calibrate1x2, IDENTITY_SET, type CalibratorSet } from "./calibration";
import { confidenceScore, type Band } from "./confidence";
import { buildRationale } from "./rationale";
import { inputsHash } from "./hash";

export interface NewsInput { confirmedStarterAbsences: number } // only CONFIRMED starters

export interface PredictInput {
  fit: LeagueFit;
  homeId: string; awayId: string;
  homeName: string; awayName: string;
  kickoff: Date;
  restHomeDays: number | null; restAwayDays: number | null;
  newsHome: NewsInput | null; newsAway: NewsInput | null; // null = not fetched
  formHome: string; formAway: string;
  calibrators?: CalibratorSet; calibrationResidual?: number;
  neutral?: boolean; // tournament finals at neutral venues: no home advantage
  earlySeason?: boolean; // either side has < 6 matches this season
  priorHome?: boolean; priorAway?: boolean; // rating leans on a promoted/relegated prior
}

export interface PredictOutput {
  modelVersion: typeof MODEL_VERSION;
  inputsHash: string;
  lambdaHome: number; lambdaAway: number; rho: number;
  raw: Markets; cal: Markets;
  rawBy2: { home: number; away: number }; calBy2: { home: number; away: number };
  predHomeGoals: number; predAwayGoals: number;
  topScorelines: Scoreline[];
  matrix: number[][];
  confidence: number; band: Band;
  dataFlags: string[];
  rationale: string[];
  features: Record<string, unknown>;
}

/** φ_rest: +1.2% per rest day above 4, clamped to [0.95, 1.03]; 1 when unknown. */
export function phiRest(days: number | null): number {
  if (days == null) return 1;
  return Math.min(1.03, Math.max(0.95, 1 + 0.012 * (days - 4)));
}
/** φ_news: −4% per confirmed starter absence, floor 0.88; 1 when unknown. Never invented. */
export function phiNews(n: NewsInput | null): number {
  if (!n) return 1;
  return Math.max(0.88, 1 - 0.04 * n.confirmedStarterAbsences);
}

export function predictFixture(inp: PredictInput): PredictOutput {
  const flags: string[] = [];
  const th: TeamRating = inp.fit.teams.get(inp.homeId) ?? (flags.push("new_team_home"), priorRating(inp.fit));
  const ta: TeamRating = inp.fit.teams.get(inp.awayId) ?? (flags.push("new_team_away"), priorRating(inp.fit));
  if (!inp.newsHome || !inp.newsAway) flags.push("missing_news");
  if (inp.restHomeDays == null || inp.restAwayDays == null) flags.push("missing_rest");
  if (Math.min(th.sampleWeight, ta.sampleWeight) < 6) flags.push("thin_sample");
  if (inp.fit.inputKind === "goals") flags.push("goals_only_ratings");

  const g = inp.neutral ? 1 : inp.fit.homeAdv;
  if (inp.neutral) flags.push("neutral_venue");
  const lambdaHome = th.attack * ta.defence * g * phiRest(inp.restHomeDays) * phiNews(inp.newsHome);
  const lambdaAway = ta.attack * th.defence * phiRest(inp.restAwayDays) * phiNews(inp.newsAway);
  const rho = inp.fit.rho;

  const m = scoreMatrix(lambdaHome, lambdaAway, rho);
  const raw = marketsFromMatrix(m);
  const top = topScorelines(m, 5);
  const rawBy2 = winByAtLeast(m, 2);

  const cs = inp.calibrators ?? IDENTITY_SET;
  const x = calibrate1x2(cs, raw);
  const cal: Markets = {
    ...x,
    over15: apply(cs.over15, raw.over15), over25: apply(cs.over25, raw.over25),
    over35: apply(cs.over35, raw.over35), over45: apply(cs.over45, raw.over45), btts: apply(cs.btts, raw.btts),
  };

  const sorted = [cal.home, cal.draw, cal.away].sort((a, b) => b - a);
  const restGap = inp.restHomeDays != null && inp.restAwayDays != null ? Math.abs(inp.restHomeDays - inp.restAwayDays) : null;
  const { score, band } = confidenceScore({
    sampleHome: th.sampleWeight, sampleAway: ta.sampleWeight,
    newsComplete: !flags.includes("missing_news"),
    volatility: inp.fit.volatility, restGapDays: restGap,
    calibrationResidual: inp.calibrationResidual ?? 0, margin1x2: sorted[0] - sorted[1],
    penalty: (inp.earlySeason ? 8 : 0) + (inp.priorHome || inp.priorAway ? 5 : 0),
  });
  if (inp.earlySeason) flags.push("early_season");
  if (inp.priorHome) flags.push("prior_home");
  if (inp.priorAway) flags.push("prior_away");

  // Win-by-2 is scaled with the calibrated win probability of the same side (keeps it consistent with 1X2).
  const calBy2 = { home: raw.home > 0 ? rawBy2.home * (cal.home / raw.home) : 0, away: raw.away > 0 ? rawBy2.away * (cal.away / raw.away) : 0 };
  if (band === "LOW") capLow(cal, flags);

  const features = {
    attackHome: th.attack, defenceHome: th.defence, attackAway: ta.attack, defenceAway: ta.defence,
    sampleHome: th.sampleWeight, sampleAway: ta.sampleWeight, homeAdv: g, rho,
    restHomeDays: inp.restHomeDays, restAwayDays: inp.restAwayDays,
    newsHome: inp.newsHome, newsAway: inp.newsAway,
    formHome: inp.formHome, formAway: inp.formAway,
    inputKind: inp.fit.inputKind, volatility: inp.fit.volatility,
  };
  const rationale = buildRationale({
    homeName: inp.homeName, awayName: inp.awayName,
    attackHome: th.attack, defenceHome: th.defence, attackAway: ta.attack, defenceAway: ta.defence,
    homeAdv: g, lambdaHome, lambdaAway, formHome: inp.formHome, formAway: inp.formAway,
    markets: cal, dataFlags: flags, inputKind: inp.fit.inputKind,
  });

  return {
    modelVersion: MODEL_VERSION,
    inputsHash: inputsHash({ homeId: inp.homeId, awayId: inp.awayId, kickoff: inp.kickoff.toISOString(), ...features, calN: cs.home.n }),
    lambdaHome, lambdaAway, rho, raw, cal, rawBy2, calBy2,
    predHomeGoals: top[0].h, predAwayGoals: top[0].a,
    topScorelines: top, matrix: truncateMatrix(m), confidence: score, band,
    dataFlags: flags, rationale, features,
  };
}

/**
 * Low confidence never displays ≥ 90% on any market. Binary lines are shown both ways
 * (over and its under = 1 − over), so each over is kept inside [1 − cap, cap].
 */
function capLow(c: Markets, flags: string[]) {
  let capped = false;
  for (const k of ["over15", "over25", "over35", "over45", "btts"] as const) {
    if (c[k] > LOW_BAND_DISPLAY_CAP) { c[k] = LOW_BAND_DISPLAY_CAP; capped = true; }
    if (c[k] < 1 - LOW_BAND_DISPLAY_CAP) { c[k] = 1 - LOW_BAND_DISPLAY_CAP; capped = true; }
  }
  for (const k of ["home", "draw", "away"] as const) {
    if (c[k] > LOW_BAND_DISPLAY_CAP) {
      const excess = c[k] - LOW_BAND_DISPLAY_CAP;
      const others = (["home", "draw", "away"] as const).filter((o) => o !== k);
      const s = others.reduce((t, o) => t + c[o], 0) || 1;
      others.forEach((o) => (c[o] += (excess * c[o]) / s));
      c[k] = LOW_BAND_DISPLAY_CAP; capped = true;
    }
  }
  if (capped) flags.push("low_band_capped");
}
