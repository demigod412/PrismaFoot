"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "./ui";

export interface DayChip { key: string; top: string; num: string }

/**
 * Mobile-friendly date picker strip.
 *  - the selected day highlights instantly (optimistic) and a spinner shows while the page loads
 *  - the selected chip is always scrolled into view (centre)
 *  - ‹ › step one day; the calendar button opens the phone's native date picker
 *  - horizontal swipes never trigger pull-to-refresh (data-no-ptr)
 */
export function DateStrip({ days, active, base, extra = "" }: { days: DayChip[]; active: string; base: string; extra?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(active);
  const strip = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  useEffect(() => setSel(active), [active]);
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-key="${sel}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [sel]);

  const url = (key: string) => `${base}?date=${key}${extra}`;
  const go = (key: string) => {
    if (!days.some((d) => d.key === key) || key === sel) return;
    setSel(key);
    target.current = url(key);
    start(() => router.push(url(key), { scroll: false }));
  };
  // Safety net: if an in-app navigation hasn't finished after 6 s (slow network, stale app cache),
  // load the page the normal way so the user never sees an endless spinner.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => { if (target.current) window.location.assign(target.current); }, 6000);
    return () => clearTimeout(t);
  }, [pending]);
  // Warm up the neighbouring days so switching is instant
  useEffect(() => {
    const i = days.findIndex((d) => d.key === active);
    [days[i - 1], days[i + 1]].forEach((d) => d && router.prefetch(url(d.key)));
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const idx = days.findIndex((d) => d.key === sel);

  return (
    <div data-no-ptr className="mb-4">
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Previous day" disabled={idx <= 0} onClick={() => go(days[idx - 1].key)}
          className="focus-ring grid h-11 w-9 shrink-0 place-items-center rounded-xl border hairline text-slate-300 disabled:opacity-30">
          <ChevronLeft size={18} />
        </button>
        <div ref={strip} role="tablist" aria-label="Dates"
          className="flex min-w-0 flex-1 snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ touchAction: "pan-x" }}>
          {days.map((d) => {
            const on = d.key === sel;
            return (
              <button key={d.key} type="button" role="tab" aria-selected={on} data-key={d.key} onClick={() => go(d.key)}
                className={cn("focus-ring flex h-11 w-14 shrink-0 snap-center flex-col items-center justify-center rounded-xl border transition-colors duration-200",
                  on ? "border-edge/50 bg-edge/10 text-edge" : "hairline text-slate-300 active:bg-white/[0.08]")}>
                <span className="text-[10px] leading-none opacity-70">{d.top}</span>
                <span className="num mt-1 text-sm leading-none">{d.num}</span>
              </button>
            );
          })}
        </div>
        <button type="button" aria-label="Next day" disabled={idx >= days.length - 1} onClick={() => go(days[idx + 1].key)}
          className="focus-ring grid h-11 w-9 shrink-0 place-items-center rounded-xl border hairline text-slate-300 disabled:opacity-30">
          <ChevronRight size={18} />
        </button>
        <label className="focus-ring relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border hairline text-slate-300" aria-label="Pick a date">
          {pending ? <Loader2 size={18} className="animate-spin text-edge" /> : <CalendarDays size={18} />}
          <input ref={picker} type="date" value={sel} min={days[0]?.key} max={days[days.length - 1]?.key}
            onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* older browsers open on focus */ } }}
            onChange={(e) => go(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
      </div>
      <p aria-live="polite" className="sr-only">{pending ? "Loading" : ""}</p>
    </div>
  );
}
