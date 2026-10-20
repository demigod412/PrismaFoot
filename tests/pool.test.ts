import { describe, expect, it } from "vitest";
import { fitLeague, fitPool, type HistMatch, type PoolMember } from "@/lib/model/ratings";
import { makeRng, poissonSample } from "@/lib/demo/rng";

/** Two leagues, the second clearly weaker, joined by a few cup ties; plus clubs seen only in the cup. */
function pyramid(seed: number) {
  const rng = makeRng(seed);
  const strong = [...Array(16).keys()].map((i) => ({ id: `s${i}`, a: 1.25, d: 0.8 }));
  const weak = [...Array(16).keys()].map((i) => ({ id: `w${i}`, a: 0.8, d: 1.25 }));
  const out = [...Array(4).keys()].map((i) => ({ id: `o${i}`, a: 0.6, d: 1.6 }));
  const all = new Map([...strong, ...weak, ...out].map((t) => [t.id, t]));
  const ms: HistMatch[] = [];
  const t0 = Date.UTC(2026, 0, 1);
  const play = (h: string, a: string, day: number) => {
    const H = all.get(h)!, A = all.get(a)!;
    ms.push({ homeId: h, awayId: a, date: new Date(t0 + day * 864e5), homeGoals: poissonSample(rng, 1.2 * H.a * A.d * 1.25), awayGoals: poissonSample(rng, 1.2 * A.a * H.d) });
  };
  for (const lg of [strong, weak]) for (let r = 0; r < 2; r++) for (const h of lg) for (const a of lg) if (h !== a) play(h.id, a.id, (ms.length % 200));
  for (let k = 0; k < 8; k++) play(strong[k].id, weak[k].id, 150);
  for (let k = 0; k < 4; k++) play(out[k].id, strong[k + 8].id, 160);
  const members = new Map<string, PoolMember>([...strong.map((t) => [t.id, { group: "S", tier: 1 }] as const), ...weak.map((t) => [t.id, { group: "W", tier: 2 }] as const)]);
  return { ms, members };
}

describe("pooled fit", () => {
  it("rates a club seen only in the cup below the weakest league, not at the pool average", () => {
    const { ms, members } = pyramid(3);
    const asOf = new Date(Date.UTC(2026, 8, 1));
    const single = fitLeague(ms, asOf);
    const { fit, outsiders } = fitPool(ms, asOf, { members });
    expect([...outsiders].sort()).toEqual(["o0", "o1", "o2", "o3"]);
    const strength = (f: typeof fit, id: string) => f.teams.get(id)!.attack / f.teams.get(id)!.defence;
    const meanWeak = [...members.keys()].filter((k) => k.startsWith("w")).reduce((s, id) => s + strength(fit, id), 0) / 16;
    for (const o of outsiders) {
      expect(strength(fit, o)).toBeLessThan(meanWeak);
      expect(strength(fit, o)).toBeLessThan(strength(single, o)); // the single fit flatters them
    }
  });

  it("leaves well-sampled clubs essentially where the single fit put them", () => {
    const { ms, members } = pyramid(5);
    const asOf = new Date(Date.UTC(2026, 8, 1));
    const single = fitLeague(ms, asOf), { fit } = fitPool(ms, asOf, { members });
    for (const id of ["s0", "s5", "w3", "w9"]) {
      const r = fit.teams.get(id)!.attack / single.teams.get(id)!.attack;
      expect(r).toBeGreaterThan(0.9); expect(r).toBeLessThan(1.1);
    }
  });

  it("is the plain fit when the pool has no domestic leagues (national teams)", () => {
    const { ms } = pyramid(7);
    const asOf = new Date(Date.UTC(2026, 8, 1));
    const { fit, outsiders } = fitPool(ms, asOf, { members: new Map() });
    expect(outsiders.size).toBe(0);
    expect(fit.teams.get("s0")!.attack).toBeCloseTo(fitLeague(ms, asOf).teams.get("s0")!.attack, 10);
  });
});
