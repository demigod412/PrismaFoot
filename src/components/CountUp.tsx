"use client";
import { useEffect, useRef, useState } from "react";

/** Counts a percentage up once on mount (200ms ease-out). Respects reduced motion. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const target = Math.round(value * 100);
  const [v, setV] = useState(target);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    started.current = true;
    const t0 = performance.now(); let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 600); const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(target * e)); if (k < 1) raf = requestAnimationFrame(tick);
    };
    setV(0); raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <span className={className}>{v}%</span>;
}
