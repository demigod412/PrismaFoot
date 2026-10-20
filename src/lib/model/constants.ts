export const MODEL_VERSION = "dc-xg-cal-v1" as const;
export const HALF_LIFE_DAYS = 75;
export const MAX_GOALS = 10; // matrix is 0..10 × 0..10, tail mass renormalized away
export const DEFAULT_RHO = -0.08;
export const RHO_PRIOR_MATCHES = 200; // ρ shrinkage strength
export const SHRINK_PSEUDO_MATCHES = 4; // team shrinkage toward league mean
export const CALIBRATION_MIN_N = 50;
export const ISOTONIC_MIN_N = 200;
export const LOW_BAND_DISPLAY_CAP = 0.89;
/** Pooled fits (cups): pseudo-matches pulling a club with no domestic league in the pool toward "below the weakest league". */
export const OUTSIDER_PRIOR_WEIGHT = 8;
/** An outsider is assumed one step below the weakest league in the pool: same step as a promoted side. */
export const OUTSIDER_STEP = { a: 0.85, d: 1.15 } as const;
