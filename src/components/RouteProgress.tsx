"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar across the top while a navigation is in flight.
 *
 * `loading.tsx` only covers a move to a different route. Most of this app's waiting is a *same* route
 * with different search params — switching the Upcoming/Live/Finished tab, changing the date, picking
 * a league, moving the builder's target — and every page is server-rendered against the database, so
 * those can take a second or two with nothing on screen to say so. That reads as a hang.
 *
 * Clicks are caught on the way down (capture phase) rather than wrapping every Link, so this covers
 * the whole app from one place, including plain anchors. It clears when the path or query actually
 * changes, and has a timeout so a cancelled or failed navigation can never leave the bar stuck on.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);

  // A navigation that lands changes one of these.
  useEffect(() => setBusy(false), [pathname, search]);

  useEffect(() => {
    const here = `${pathname}${search.toString() ? `?${search}` : ""}`;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      // Internal, same-tab, actually going somewhere else.
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (a.getAttribute("target") === "_blank" || a.hasAttribute("download")) return;
      if (href === here) return;
      setBusy(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, search]);

  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 20_000);
    return () => clearTimeout(t);
  }, [busy]);

  if (!busy) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-edge/15">
      <div className="route-bar h-full w-2/5 bg-edge" />
      <span role="status" aria-live="polite" className="sr-only">Loading</span>
    </div>
  );
}
