"use client";
import { useState, useTransition } from "react";
import { Loader2, Ticket } from "lucide-react";
import { addManyToSlip, bookBlend, type BookResult } from "@/app/slips/actions";
import type { MarketKey } from "@/lib/markets";
import { CopyButton } from "./CopyButton";
import { cn, pct } from "./ui";

export interface BuilderLeg { fixtureId: string; market: string; label: string; match: string; league: string; p: number; odds: number; real: boolean; group: string; when: string }
export interface BuilderSlip { odds: number; p: number; adjusted: number; edge: number; real: boolean; legs: BuilderLeg[] }

/** One generated combination: legs, price, honest chance, and the three ways to use it. */
export function BuilderResult({ slip, index, target }: { slip: BuilderSlip; index: number; target: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookResult | null>(null);
  const [pending, start] = useTransition();
  const oneIn = Math.round(1 / slip.adjusted);
  const text = [`${slip.legs.length} legs · odds ${slip.odds.toFixed(2)} · model chance ${(slip.adjusted * 100).toFixed(1)}%`,
    ...slip.legs.map((l, i) => `${i + 1}. ${l.match} (${l.when}): ${l.label} — ${(l.p * 100).toFixed(0)}%${l.real ? ` @${l.odds.toFixed(2)}` : ""}`),
    "PitchEdge estimates, not guarantees. 18+"].join("\n");

  return (
    <section className={cn("glass p-4", index === 0 && "border-edge/40")}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{index === 0 ? "Best combination" : `Alternative ${index}`} <span className="num text-slate-500">{slip.legs.length} legs</span></h2>
        <div className="num text-right text-sm">
          <span className="text-edge">{slip.odds.toFixed(2)}</span> <span className="text-slate-500">odds</span>
          <span className="ml-3 text-slate-300">{pct(slip.adjusted)}</span> <span className="text-slate-500">chance · about 1 in {oneIn}</span>
        </div>
      </header>
      {slip.odds < target * 0.98 && <p className="mb-2 text-[11px] text-amber">Closest available: nothing in this window reached {target.toFixed(2)} within the leg limit.</p>}
      <ol className="divide-y divide-white/[0.06]">
        {slip.legs.map((l) => (
          <li key={`${l.fixtureId}-${l.market}`} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-100">{l.label}</div>
              <div className="truncate text-[11px] text-slate-500">{l.match} · {l.league} · <span className="num">{l.when}</span> · {l.group}</div>
            </div>
            <div className="num text-right text-xs">
              <div className="text-slate-200">{pct(l.p)}</div>
              <div className={cn("text-[10px]", l.real ? "text-edge" : "text-slate-500")}>{l.real ? `@${l.odds.toFixed(2)}` : `fair ${l.odds.toFixed(2)}`}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button disabled={pending} onClick={() => start(async () => setMsg((await addManyToSlip(slip.legs.map((l) => ({ fixtureId: l.fixtureId, market: l.market as MarketKey })), `${slip.odds.toFixed(2)} odds`)).message))}
          className="focus-ring rounded-lg border hairline px-2.5 py-1.5 text-xs text-slate-200 hover:border-edge/40 hover:text-edge disabled:opacity-50">
          {pending ? <Loader2 size={14} className="inline animate-spin" /> : null} Save as slip
        </button>
        <CopyButton text={text} label="Copy" />
        <button disabled={pending} onClick={() => start(async () => setBooking(await bookBlend(slip.legs.map((l) => ({ fixtureId: l.fixtureId, market: l.market as MarketKey, label: `${l.match}: ${l.label}` })))))}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-edge/40 px-2.5 py-1.5 text-xs text-edge hover:bg-edge/10 disabled:opacity-50">
          <Ticket size={14} />Sportybet code
        </button>
        {slip.real && <span className="num text-[11px] text-slate-500">edge {slip.edge >= 0 ? "+" : ""}{Math.round(slip.edge * 100)}%</span>}
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
      {booking && !booking.code && <p className="mt-2 text-[11px] text-miss">{booking.message}</p>}
      {booking?.note && booking.code && <p className="mt-2 text-[11px] text-amber">{booking.note}</p>}
      {msg && <p className="mt-2 text-[11px] text-slate-400">{msg}</p>}
    </section>
  );
}
