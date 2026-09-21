"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

/**
 * Pull-to-refresh that only reacts to clear downward pulls from the top of the page.
 * Horizontal swipes (date strip, chip rows) and anything inside [data-no-ptr] are ignored.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef<"pull" | "ignore" | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <div
      onTouchStart={(e) => {
        const t = e.target as HTMLElement;
        locked.current = null;
        start.current = window.scrollY <= 0 && !t.closest("[data-no-ptr]") ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      }}
      onTouchMove={(e) => {
        if (!start.current || locked.current === "ignore") return;
        const dx = e.touches[0].clientX - start.current.x, dy = e.touches[0].clientY - start.current.y;
        if (!locked.current) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          locked.current = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.5 ? "pull" : "ignore";
          if (locked.current === "ignore") return;
        }
        setPull(Math.max(0, Math.min(90, dy)));
      }}
      onTouchEnd={() => {
        if (locked.current === "pull" && pull > 64) { setBusy(true); router.refresh(); setTimeout(() => setBusy(false), 900); }
        start.current = null; locked.current = null; setPull(0);
      }}>
      <div aria-live="polite" className="grid place-items-center overflow-hidden text-xs text-slate-400 transition-[height] duration-200 ease-out" style={{ height: busy ? 32 : pull / 2 }}>
        {busy ? "Refreshing…" : pull > 64 ? "Release to refresh" : pull > 0 ? "Pull to refresh" : null}
      </div>
      {children}
    </div>
  );
}
