"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

/** Touch pull-to-refresh: re-renders the server component (reads the Postgres cache, never the vendor). */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const y0 = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <div
      onTouchStart={(e) => { if (window.scrollY <= 0) y0.current = e.touches[0].clientY; }}
      onTouchMove={(e) => { if (y0.current != null) setPull(Math.max(0, Math.min(90, e.touches[0].clientY - y0.current))); }}
      onTouchEnd={() => {
        if (pull > 64) { setBusy(true); router.refresh(); setTimeout(() => setBusy(false), 900); }
        y0.current = null; setPull(0);
      }}>
      <div aria-live="polite" className="grid place-items-center overflow-hidden text-xs text-slate-400 transition-[height] duration-200 ease-out" style={{ height: busy ? 32 : pull / 2 }}>
        {busy ? "Refreshing…" : pull > 64 ? "Release to refresh" : pull > 0 ? "Pull to refresh" : null}
      </div>
      {children}
    </div>
  );
}
