import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ReactNode } from "react";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));
export const pct = (p: number) => `${Math.round(p * 100)}%`;

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("glass p-4 md:p-5", className)}>{children}</section>;
}

export function Chip({ active, children, className }: { active?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors duration-200 ease-out",
      active ? "border-edge/60 bg-edge/10 text-edge" : "hairline text-slate-300", className)}>{children}</span>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-slate-100">{children}</h2>
      {aside && <div className="text-xs text-slate-400">{aside}</div>}
    </div>
  );
}
