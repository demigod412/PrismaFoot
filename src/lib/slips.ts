import type { MarketKey } from "./markets";

/* Slip workshop maths. Pure functions; the server actions store the result. */
export interface Leg {
  fixtureId: string; market: MarketKey; label: string; match: string; kickoff: string; // ISO
  p: number; band: string; addedAt: string;
}
export const MAX_LEGS = 30;

export const combinedP = (legs: { p: number }[]) => legs.reduce((s, l) => s * l.p, 1);
export const fairOdds = (p: number) => (p > 0 ? 1 / p : Infinity);

/** One leg per match: adding a second market on the same match replaces the first. */
export function addLeg(legs: Leg[], leg: Leg): { legs: Leg[]; replaced: boolean; full: boolean } {
  const i = legs.findIndex((l) => l.fixtureId === leg.fixtureId);
  if (i >= 0) { const next = [...legs]; next[i] = leg; return { legs: next, replaced: true, full: false }; }
  if (legs.length >= MAX_LEGS) return { legs, replaced: false, full: true };
  return { legs: [...legs, leg], replaced: false, full: false };
}
export const removeLeg = (legs: Leg[], fixtureId: string) => legs.filter((l) => l.fixtureId !== fixtureId);

/** Optimise: drop the single weakest leg (lowest probability). */
export function dropWeakest(legs: Leg[]): { legs: Leg[]; dropped: Leg | null } {
  if (!legs.length) return { legs, dropped: null };
  const w = legs.reduce((m, l) => (l.p < m.p ? l : m));
  return { legs: legs.filter((l) => l !== w), dropped: w };
}
/** Optimise: drop every Low-confidence leg. */
export const dropLowConfidence = (legs: Leg[]) => ({ legs: legs.filter((l) => l.band !== "LOW"), dropped: legs.filter((l) => l.band === "LOW") });
/** Optimise: drop weakest legs until the combined probability reaches the target (or one leg is left). */
export function trimToTarget(legs: Leg[], target: number): { legs: Leg[]; dropped: Leg[] } {
  let cur = [...legs]; const dropped: Leg[] = [];
  while (cur.length > 1 && combinedP(cur) < target) { const r = dropWeakest(cur); cur = r.legs; dropped.push(r.dropped!); }
  return { legs: cur, dropped };
}

/** Split into two slips of similar strength (strongest legs dealt alternately). */
export function splitInTwo(legs: Leg[]): [Leg[], Leg[]] {
  const s = [...legs].sort((a, b) => b.p - a.p), a: Leg[] = [], b: Leg[] = [];
  s.forEach((l, i) => ((i % 2 === 0) ? a : b).push(l));
  return [a, b];
}

/** Merge b into a. Same match in both: keep the higher-probability leg and report the duplicate. */
export function mergeSlips(a: Leg[], b: Leg[]): { legs: Leg[]; duplicates: string[] } {
  const out = new Map(a.map((l) => [l.fixtureId, l])); const duplicates: string[] = [];
  for (const l of b) {
    const cur = out.get(l.fixtureId);
    if (cur) { duplicates.push(l.match); if (l.p > cur.p) out.set(l.fixtureId, l); }
    else out.set(l.fixtureId, l);
  }
  return { legs: [...out.values()].slice(0, MAX_LEGS), duplicates };
}

export function slipText(name: string, legs: Leg[], fmtKickoff: (iso: string) => string) {
  const p = combinedP(legs);
  return [
    `${name} — ${legs.length} leg${legs.length === 1 ? "" : "s"}`,
    ...legs.map((l, i) => `${i + 1}. ${l.match} (${fmtKickoff(l.kickoff)}): ${l.label} — ${(l.p * 100).toFixed(0)}%`),
    `Combined model probability ${(p * 100).toFixed(1)}% · fair odds ${fairOdds(p).toFixed(2)}`,
    `PitchEdge statistical estimates, not guarantees. 18+`,
  ].join("\n");
}
