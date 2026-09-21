"use client";
import { useMemo, useState } from "react";
import type { ConfidenceBand } from "@prisma/client";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { cn, pct } from "./ui";

export interface BlendCandidate { id: string; title: string; when: string; band: ConfidenceBand; markets: Record<string, number> }
type Leg = { fixtureId: string; title: string; market: string; p: number };

export function BlendBuilder({ candidates }: { candidates: BlendCandidate[] }) {
  const [legs, setLegs] = useState<Leg[]>([]);
  const combined = useMemo(() => legs.reduce((s, l) => s * l.p, 1), [legs]);
  const toggle = (c: BlendCandidate, market: string) => setLegs((ls) => {
    const same = ls.find((l) => l.fixtureId === c.id);
    if (same?.market === market) return ls.filter((l) => l.fixtureId !== c.id);
    return [...ls.filter((l) => l.fixtureId !== c.id), { fixtureId: c.id, title: c.title, market, p: c.markets[market] }]; // one leg per fixture
  });
  const copy = () => navigator.clipboard?.writeText(
    legs.map((l) => `${l.title}: ${l.market} (${pct(l.p)})`).join("\n") + `\nCombined model p ${pct(combined)} · fair odds ${(1 / combined).toFixed(2)} · PitchEdge dc-xg-cal-v1`);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <ul className="space-y-2">
        {candidates.map((c) => {
          const on = legs.find((l) => l.fixtureId === c.id);
          return (
            <li key={c.id} className="glass p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-sm"><span className="truncate">{c.title}</span><span className="flex items-center gap-2"><span className="num text-xs text-slate-500">{c.when}</span><ConfidenceBadge band={c.band} /></span></div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(c.markets).map(([m, p]) => (
                  <button key={m} onClick={() => toggle(c, m)} aria-pressed={on?.market === m}
                    className={cn("focus-ring rounded-full border px-2.5 py-1 text-xs transition-colors duration-200", on?.market === m ? "border-edge bg-edge/15 text-edge" : "hairline text-slate-300 hover:bg-white/[0.05]")}>
                    {m} <span className="num opacity-80">{pct(p)}</span>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <aside className="glass sticky top-4 h-fit p-4" aria-live="polite">
        <h2 className="text-sm font-semibold">Blend <span className="num text-slate-500">{legs.length} legs</span></h2>
        {legs.length === 0 ? <p className="mt-2 text-sm text-slate-400">Tap a market on any fixture to add a leg.</p> : (
          <>
            <ul className="mt-3 space-y-1.5 text-xs">
              {legs.map((l) => <li key={l.fixtureId} className="flex justify-between gap-2"><span className="truncate text-slate-300">{l.title} · {l.market}</span><span className="num">{pct(l.p)}</span></li>)}
            </ul>
            <div className="mt-4 border-t hairline pt-3">
              <div className="flex justify-between text-sm"><span className="text-slate-400">Combined p</span><span className="num text-edge">{(combined * 100).toFixed(1)}%</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-400">Fair odds (1/p)</span><span className="num">{(1 / combined).toFixed(2)}</span></div>
            </div>
            <p className={cn("mt-3 text-xs leading-relaxed", legs.length >= 5 ? "text-amber" : "text-slate-400")}>
              Combined probability multiplies legs as if independent. Correlated legs (same league weekend, same-game markets) make this estimate less reliable.
              {legs.length >= 5 && ` With ${legs.length} legs the blend is expected to lose most of the time.`}
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={copy} className="focus-ring rounded-lg border border-edge/40 px-3 py-1.5 text-sm text-edge hover:bg-edge/10">Copy slip text</button>
              <button onClick={() => setLegs([])} className="focus-ring px-2 text-sm text-slate-400">Clear</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
