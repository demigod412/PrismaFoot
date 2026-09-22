"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "./ui";

export interface Opt { value: string; label: string; href: string; group?: string }

/**
 * Compact filter: one dropdown instead of a long row of chips (much easier on a phone).
 * Options carry their own href (server components can't pass functions to client components).
 */
export function FilterSelect({ label, value, options, className }: { label: string; value: string; options: Opt[]; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <label className={cn("relative inline-flex min-w-0 items-center gap-2 rounded-xl border hairline bg-white/[0.02] px-3 py-2", className)}>
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => { const href = options.find((o) => o.value === e.target.value)?.href; if (href) start(() => router.push(href, { scroll: false })); }}
        className="focus-ring min-w-0 flex-1 appearance-none truncate bg-transparent pr-5 text-sm text-slate-100 outline-none"
      >
        {groups.map((g) => {
          const rows = options.filter((o) => (o.group ?? "") === g);
          return g
            ? <optgroup key={g} label={g} className="bg-ink-950">{rows.map((o) => <option key={o.value} value={o.value} className="bg-ink-950">{o.label}</option>)}</optgroup>
            : rows.map((o) => <option key={o.value} value={o.value} className="bg-ink-950">{o.label}</option>);
        })}
      </select>
      <span className="pointer-events-none absolute right-2 text-slate-500">{pending ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}</span>
    </label>
  );
}
