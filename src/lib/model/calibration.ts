import { CALIBRATION_MIN_N, ISOTONIC_MIN_N } from "./constants";

export type Knots = [number, number][]; // sorted by x; piecewise-linear map
export type Method = "identity" | "bucket" | "isotonic";
export interface Calibrator { method: Method; n: number; knots: Knots }

export const IDENTITY: Calibrator = { method: "identity", n: 0, knots: [[0, 0], [1, 1]] };

/** Pool-Adjacent-Violators on (x, y, w) sorted by x → non-decreasing block means. */
export function pav(xs: number[], ys: number[], ws: number[]): Knots {
  type B = { x: number; y: number; w: number };
  const blocks: B[] = [];
  for (let i = 0; i < xs.length; i++) {
    blocks.push({ x: xs[i] * ws[i], y: ys[i] * ws[i], w: ws[i] });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], p = blocks[blocks.length - 2];
      if (p.y / p.w <= b.y / b.w) break;
      blocks.splice(-2, 2, { x: p.x + b.x, y: p.y + b.y, w: p.w + b.w });
    }
  }
  return blocks.map((b) => [b.x / b.w, b.y / b.w]);
}

/**
 * Fit one binary calibrator from settled (raw p, outcome 0/1) pairs.
 *   n < 50        → identity (not enough evidence)
 *   50 ≤ n < 200  → 10 equal-count buckets, each bucket's rate shrunk toward its mean p
 *                   with m = 10 pseudo-observations, then PAV for monotonicity
 *   n ≥ 200       → isotonic regression (PAV), lightly shrunk toward identity (m = 5 per block)
 * Anchors (0,0) and (1,1) are added so the map is defined everywhere.
 */
export function fitBinary(raw: number[], y: (0 | 1)[]): Calibrator {
  const n = raw.length;
  if (n < CALIBRATION_MIN_N) return { ...IDENTITY, n };
  const idx = raw.map((_, i) => i).sort((i, j) => raw[i] - raw[j]);
  const xs = idx.map((i) => raw[i]); const ys = idx.map((i) => y[i]);
  let knots: Knots;
  if (n < ISOTONIC_MIN_N) {
    const B = 10, m = 10;
    const bx: number[] = [], by: number[] = [], bw: number[] = [];
    for (let b = 0; b < B; b++) {
      const lo = Math.floor((b * n) / B), hi = Math.floor(((b + 1) * n) / B);
      if (hi <= lo) continue;
      const px = xs.slice(lo, hi), py = ys.slice(lo, hi);
      const mp = px.reduce((s, v) => s + v, 0) / px.length;
      const hits = py.reduce<number>((s, v) => s + v, 0);
      bx.push(mp); by.push((hits + m * mp) / (px.length + m)); bw.push(px.length);
    }
    knots = pav(bx, by, bw);
    return { method: "bucket", n, knots: anchor(knots) };
  }
  const blocks = pav(xs, ys.map(Number), xs.map(() => 1));
  knots = blocks.map(([x, v]) => [x, (v * 20 + x * 5) / 25]); // mild shrink toward diagonal
  return { method: "isotonic", n, knots: anchor(knots) };
}

function anchor(k: Knots): Knots {
  const out: Knots = [[0, 0], ...k.filter(([x]) => x > 0 && x < 1), [1, 1]];
  // enforce monotone y after anchoring
  for (let i = 1; i < out.length; i++) if (out[i][1] < out[i - 1][1]) out[i][1] = out[i - 1][1];
  return out;
}

export function apply(c: Calibrator, p: number): number {
  const k = c.knots;
  if (p <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (p <= k[i][0]) {
      const [x0, y0] = k[i - 1], [x1, y1] = k[i];
      const t = x1 === x0 ? 0 : (p - x0) / (x1 - x0);
      return clamp01(y0 + t * (y1 - y0));
    }
  }
  return k[k.length - 1][1];
}

export interface CalibratorSet {
  home: Calibrator; draw: Calibrator; away: Calibrator;
  over15: Calibrator; over25: Calibrator; over35: Calibrator; over45: Calibrator; btts: Calibrator;
}
export const IDENTITY_SET: CalibratorSet = {
  home: IDENTITY, draw: IDENTITY, away: IDENTITY, over15: IDENTITY, over25: IDENTITY, over35: IDENTITY, over45: IDENTITY, btts: IDENTITY,
};

/** 1X2: calibrate each outcome one-vs-rest, then renormalize to sum to 1. */
export function calibrate1x2(cs: CalibratorSet, p: { home: number; draw: number; away: number }) {
  const h = apply(cs.home, p.home), d = apply(cs.draw, p.draw), a = apply(cs.away, p.away);
  const s = h + d + a || 1;
  return { home: h / s, draw: d / s, away: a / s };
}

/** Mean |calibrated − raw| over the last fit window; feeds the confidence score. */
export function calibrationResidual(pairs: { raw: number; cal: number }[]): number {
  if (!pairs.length) return 0;
  return pairs.reduce((s, x) => s + Math.abs(x.cal - x.raw), 0) / pairs.length;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
