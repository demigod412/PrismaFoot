"use client";
import { useMemo, useState, useTransition } from "react";
import type { ConfidenceBand } from "@prisma/client";
import { Loader2, Ticket } from "lucide-react";
import { bookBlend, type BookResult } from "@/app/slips/actions";
import type { MarketKey } from "@/lib/markets";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { CopyButton } from "./CopyButton";
import { cn, pct } from "./ui";

export interface BlendCandidate { id: string; title: string; when: string; band: ConfidenceBand; markets: { key: MarketKey; label: string; p: number }[] }
type Leg = { fixtureId: string; title: string; key: MarketKey; market: string; p: number };

export function BlendBuilder({ candidates }: { candidates: BlendCandidate[] }) {
  const [legs, setLegs] = useState<Leg[]>([]);
  const [booking, setBooking] = useState<BookResult | null>(null);
  const [pending, start] = useTransition();
  const combined = useMemo(() => legs.reduce((s, l) => s * l.p, 1), [legs]);
  const toggle = (c: BlendCandidate, m: BlendCandidate["markets"][number]) => {
    setBooking(null); // selection changed → any earlier code no longer matches
    setLegs((ls) => {
      const same = ls.find((l) => l.fixtureId === c.id);
      if (same?.key === m.key) return ls.filter((l) => l.fixtureId !== c.id);
      return [...ls.filter((l) => l.fixtureId !== c.id), { fixtureId: c.id, title: c.title, key: m.key, market: m.label, p: m.p }]; // one leg per fixture
    });
  };
  const text = legs.map((l) => `${l.title}: ${l.market} (${pct(l.p)})`).join("\n") + `\nCombined model p ${pct(combined)} · fair odds ${(1 / combined).toFixed(2)} · PitchEdge dc-xg-cal-v1`;
  const book = () => start(async () => setBooking(await bookBlend(legs.map((l) => ({ fixtureId: l.fixtureId, market: l.key, label: `${l.title}: ${l.market}` })))));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <ul className="space-y-2">
        {candidates.map((c) => {
          const on = legs.find((l) => l.fixtureId === c.id);
          return (
            <li key={c.id} className="glass p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-sm"><span className="truncate">{c.title}</span><span className="flex items-center gap-2"><span className="num text-xs text-slate-500">{c.when}</span><ConfidenceBadge band={c.band} /></span></div>
              <div className="flex flex-wrap gap-1.5">
                {c.markets.map((m) => (
                  <button key={m.key} onClick={() => toggle(c, m)} aria-pressed={on?.key === m.key}
                    className={cn("focus-ring rounded-full border px-2.5 py-1 text-xs transition-colors duration-200", on?.key === m.key ? "border-edge bg-edge/15 text-edge" : "hairline text-slate-300 hover:bg-white/[0.05]")}>
                    {m.label} <span className="num opacity-80">{pct(m.p)}</span>
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
              Combined probability multiplies legs as if independent. Correlated legs make this estimate less reliable.
              {legs.length >= 5 && ` With ${legs.length} legs the blend is expected to lose most of the time.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton text={text} label="Copy blend text" />
              <button onClick={book} disabled={pending}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-edge/40 px-2.5 py-1.5 text-xs text-edge hover:bg-edge/10 disabled:opacity-50">
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} />}{pending ? "Getting code…" : "Sportybet code"}
              </button>
              <button onClick={() => { setLegs([]); setBooking(null); }} className="focus-ring px-2 text-sm text-slate-400">Clear</button>
            </div>
            {booking?.code && (
              <div className="mt-3 rounded-lg border border-edge/40 bg-edge/10 p-3 text-center">
                <div className="text-[11px] text-slate-400">Sportybet booking code</div>
                <div className="num select-all text-2xl font-semibold tracking-widest text-edge">{booking.code}</div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <CopyButton text={booking.code} label="Copy code" />
                  {booking.url && <a href={booking.url} target="_blank" rel="noreferrer" className="text-xs text-ice underline underline-offset-2">Open on Sportybet</a>}
                </div>
              </div>
            )}
            {booking && !booking.code && <p className="mt-2 text-[11px] leading-relaxed text-miss">{booking.message}</p>}
            {booking?.note && booking.code && <p className="mt-2 text-[11px] leading-relaxed text-amber">{booking.note}</p>}
            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">Booking codes are best effort through Sportybet&apos;s website. PitchEdge never places bets. 18+ only.</p>
          </>
        )}
      </aside>
    </div>
  );
}
