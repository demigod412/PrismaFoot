"use client";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

/**
 * A progress bar across the top of the viewport while a filter navigation is in flight.
 *
 * FilterSelect already had a pending state, but it was a 14px spinner inside the dropdown that replaced
 * the chevron. On a phone that is invisible: you tap a market, nothing appears to happen for a second or
 * two while the server renders, and the honest conclusion is that the page is broken. Several filters
 * reported as "not filtering" were in fact working and simply giving no sign of it.
 *
 * Fixed to the top rather than inline, because the thing that needs to change is the part of the screen
 * the eye is already on — and dimming the content would hide the list the person is waiting for.
 *
 * Rendered through a portal so it escapes whatever clipping or stacking context the filter row sits in.
 */
export function NavProgress({ active }: { active: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !active) return null;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-edge/15">
      <div className="h-full w-1/3 animate-nav-progress rounded-full bg-edge" />
    </div>,
    document.body,
  );
}
