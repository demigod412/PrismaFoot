/*
 * Accumulator builder: assemble the combination that reaches a target price with the best chance.
 *
 *   odds     — the bookmaker's price when we have one, otherwise the model's fair odds (1 / p)
 *   value    — edge = p × odds − 1 (only meaningful with real odds)
 *   scoring  — "value" ranks legs by edge per unit of price added; "safe" ranks by reliability
 *   spread   — one leg per match, at most 2 per competition and 2 of the same market type
 *   honesty  — with fair odds the target decides the chance (3.0 ⇒ ~33%); the search decides HOW you get there
 */
export interface Candidate {
  matchId: string; league: string; startMs: number; match: string; label: string; market: string; group: string;
  p: number; odds: number; real: boolean; band: string;
  trust?: number; // ledger-based reliability multiplier (1 = as advertised)
}
export interface BuildOptions {
  target: number; maxLegs?: number; minP?: number; mode?: "value" | "safe";
  maxPerLeague?: number; maxPerGroup?: number; band?: string; overshoot?: number;
}
export interface BuiltSlip { legs: Candidate[]; odds: number; p: number; adjusted: number; edge: number; real: boolean; short?: boolean; relaxed?: boolean }

export const DEFAULTS = { maxLegs: 12, minP: 0.5, maxPerLeague: 2, maxPerGroup: 2, overshoot: 1.35 };
/**
 * If nothing lands in the band, try again with a wider band and, after that, with the spread rules relaxed
 * (few leagues on a quiet day can make "max 2 per competition" impossible for a long target).
 */
const ATTEMPTS = [{ widen: 1, extra: 0 }, { widen: 1.6, extra: 0 }, { widen: 2.5, extra: 1 }, { widen: 4, extra: 2 }, { widen: 6, extra: 4 }];
/** Legs are not independent (same day, same competition, similar weather/market drivers): a small haircut per extra leg. */
export const adjust = (p: number, legs: number) => p * 0.98 ** Math.max(0, legs - 1);
export const oneInN = (p: number) => (p > 0 ? Math.round(1 / p) : Infinity);

const key = (legs: Candidate[]) => legs.map((l) => `${l.matchId}:${l.market}`).sort().join("|");

/**
 * Beam search over combinations. Returns the best few, strongest first, so the page can offer alternatives.
 * Complexity is bounded by the beam, so a few hundred candidates stay fast.
 */
export function buildSlips(all: Candidate[], o: BuildOptions, want = 3): BuiltSlip[] {
  for (const a of ATTEMPTS) {
    const found = search(all, o, want, a.widen, a.extra);
    if (found.length) return found.map((s) => (a.extra ? { ...s, relaxed: true } : s));
  }
  return [];
}

function search(all: Candidate[], o: BuildOptions, want: number, widen: number, extra = 0): BuiltSlip[] {
  const base = { ...DEFAULTS, ...o };
  const cfg = { ...base, maxPerLeague: base.maxPerLeague + extra, maxPerGroup: base.maxPerGroup + extra };
  const target = Math.max(1.01, o.target), ceiling = target * (1 + (cfg.overshoot - 1) * widen);
  const pool = all.filter((c) => c.p >= cfg.minP && c.odds > 1.01 && (!o.band || c.band !== "LOW"))
    .map((c) => ({ ...c, trust: c.trust ?? 1 }));
  if (!pool.length) return [];
  // Rank: value mode prefers edge per unit of price; safe mode prefers reliable probability per unit of price.
  const rank = (c: Candidate) => {
    const price = Math.log(c.odds);
    if (price <= 0) return -Infinity;
    return cfg.mode === "value" && c.real ? (c.p * c.odds - 1) / price : Math.log(c.p * (c.trust ?? 1)) / -price;
  };
  // Build a pool that is spread across BOTH matches and price levels. Taking a plain "top N" would fill up with
  // many markets from the same few matches, and the search would run out of matches long before it reached a long target.
  const priceBucket = (c: Candidate) => Math.round(Math.log(c.odds) * 10);
  const perMatch = new Map<string, Candidate[]>();
  for (const c of [...pool].sort((a, b) => rank(b) - rank(a))) {
    const rows = perMatch.get(c.matchId) ?? [];
    if (rows.length < 6 && !rows.some((x) => priceBucket(x) === priceBucket(c))) { rows.push(c); perMatch.set(c.matchId, rows); }
  }
  const sorted = [...perMatch.values()].flat().sort((a, b) => rank(b) - rank(a));

  type State = { legs: Candidate[]; logOdds: number; logP: number; matches: Set<string>; leagues: Map<string, number>; groups: Map<string, number> };
  let beam: State[] = [{ legs: [], logOdds: 0, logP: 0, matches: new Set(), leagues: new Map(), groups: new Map() }];
  const done = new Map<string, BuiltSlip>();
  for (let depth = 0; depth < cfg.maxLegs && beam.length; depth++) {
    const next: State[] = [];
    for (const st of beam) {
      for (const c of sorted) {
        if (st.matches.has(c.matchId)) continue;
        if ((st.leagues.get(c.league) ?? 0) >= cfg.maxPerLeague) continue;
        if ((st.groups.get(c.group) ?? 0) >= cfg.maxPerGroup) continue;
        const logOdds = st.logOdds + Math.log(c.odds);
        if (logOdds > Math.log(ceiling)) continue;                 // never overshoot the target band
        const legs = [...st.legs, c], logP = st.logP + Math.log(c.p);
        if (logOdds >= Math.log(target)) {
          const p = Math.exp(logP), odds = Math.exp(logOdds);
          const real = legs.every((l) => l.real);
          const slip: BuiltSlip = { legs, odds, p, adjusted: adjust(p, legs.length), edge: p * odds - 1, real };
          const k = key(legs);
          if (!done.has(k) || done.get(k)!.p < p) done.set(k, slip);
          continue;                                                 // target reached: don't extend further
        }
        next.push({ legs, logOdds, logP, matches: new Set([...st.matches, c.matchId]),
          leagues: new Map(st.leagues).set(c.league, (st.leagues.get(c.league) ?? 0) + 1),
          groups: new Map(st.groups).set(c.group, (st.groups.get(c.group) ?? 0) + 1) });
      }
    }
    // Keep the best few partial slips *at each price level*, so cheap-but-safe paths can't crowd out the ones
    // actually heading for the target (leg caps make a pure "highest probability" beam dead-end).
    const buckets = new Map<string, State[]>();
    for (const st of next.sort((a, b) => b.logP - a.logP)) {
      // Bucket by price AND leg count: a cheap 3-leg path and an expensive 3-leg path are both worth keeping,
      // and so is the same price reached with fewer legs (it leaves room to reach a long target).
      const b = `${Math.round(st.logOdds * 8)}:${st.legs.length}`;
      const rows = buckets.get(b) ?? [];
      if (rows.length < 6) { rows.push(st); buckets.set(b, rows); }
    }
    beam = [...buckets.values()].flat().slice(0, 600);
  }
  const out = [...done.values()].sort((a, b) => (cfg.mode === "value" && a.real && b.real ? b.edge - a.edge : b.p - a.p));
  // Alternatives should look different: at most half the legs shared with a slip already chosen.
  const picked: BuiltSlip[] = [];
  for (const s of out) {
    if (picked.length >= want) break;
    if (picked.some((q) => q.legs.filter((l) => s.legs.some((x) => x.matchId === l.matchId)).length > Math.max(1, Math.floor(s.legs.length / 2)))) continue;
    picked.push(s);
  }
  return picked;
}

/** Suggested leg range for a target, used for the hint under the target picker. */
export function legHint(target: number) {
  const n = Math.ceil(Math.log(target) / Math.log(1.6));
  return { min: Math.max(2, n - 1), max: n + 2, chance: 1 / target };
}
