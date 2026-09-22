export type Band = "HIGH" | "MEDIUM" | "LOW";

export interface ConfidenceInput {
  sampleHome: number;      // effective sample (Σ recency weights)
  sampleAway: number;
  newsComplete: boolean;   // lineups/injuries fetched for both teams
  volatility: number;      // league 0..1
  restGapDays: number | null; // |restHome − restAway|
  calibrationResidual: number; // mean |cal − raw|
  margin1x2: number;       // top outcome p − second outcome p
  penalty?: number;        // extra deduction (early season, prior-based ratings)
}

/**
 * Score 0–100:
 *   start 100
 *   − sample:      up to 30, linear until the thinner team reaches 12 effective matches
 *   − news:        15 if lineups/injuries missing
 *   − volatility:  20 × league volatility
 *   − rest gap:    5 if the rest-day gap is ≥ 3 days
 *   − calibration: min(15, 100 × residual)
 * Band: High ≥ 70 AND thinner sample ≥ 8 AND margin ≥ 0.15 AND news complete;
 *       Medium ≥ 45; else Low.
 */
export function confidenceScore(c: ConfidenceInput): { score: number; band: Band } {
  const s = Math.min(c.sampleHome, c.sampleAway);
  let score = 100;
  score -= 30 * Math.max(0, 1 - Math.min(1, s / 12));
  if (!c.newsComplete) score -= 15;
  score -= 20 * c.volatility;
  if (c.restGapDays != null && c.restGapDays >= 3) score -= 5;
  score -= Math.min(15, 100 * c.calibrationResidual);
  score -= c.penalty ?? 0;
  score = Math.round(Math.max(0, Math.min(100, score)));
  const highOk = score >= 70 && s >= 8 && c.margin1x2 >= 0.15 && c.newsComplete;
  const band: Band = highOk ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW";
  if (!highOk && score >= 70) return { score: 69, band };
  return { score, band };
}
