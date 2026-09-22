"use client";
import { useState, useTransition } from "react";
import { Plus, Check, Loader2 } from "lucide-react";
import { addToSlip } from "@/app/slips/actions";
import type { MarketKey } from "@/lib/markets";
import { cn } from "./ui";

/** Small "+" that adds a market to the active slip, with inline feedback. */
export function AddToSlip({ fixtureId, market, className }: { fixtureId: string; market: MarketKey; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className={cn("relative inline-flex", className)}>
      <button type="button" aria-label="Add to slip" disabled={pending}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); start(async () => { const r = await addToSlip(fixtureId, market); setMsg({ ok: r.ok, text: r.message }); setTimeout(() => setMsg(null), 2500); }); }}
        className={cn("focus-ring grid h-7 w-7 place-items-center rounded-lg border transition-colors duration-200",
          msg?.ok ? "border-edge/60 bg-edge/15 text-edge" : "hairline text-slate-300 hover:border-edge/40 hover:text-edge")}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : msg?.ok ? <Check size={14} /> : <Plus size={14} />}
      </button>
      {msg && <span role="status" className={cn("absolute right-0 top-8 z-20 w-56 rounded-lg border px-2 py-1.5 text-[11px] shadow-lg", msg.ok ? "border-edge/40 bg-ink-900 text-edge" : "border-miss/40 bg-ink-900 text-miss")}>{msg.text}</span>}
    </span>
  );
}
