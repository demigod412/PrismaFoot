import Link from "next/link";
import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { TZ } from "@/lib/time";
import { cn } from "./ui";

export function DateNav({ active, base, extra = "" }: { active: string; base: string; extra?: string }) {
  const now = new Date();
  const days = Array.from({ length: 15 }, (_, i) => addDays(now, i));
  return (
    <nav aria-label="Dates" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {days.map((d, i) => {
        const key = formatInTimeZone(d, TZ, "yyyy-MM-dd");
        const on = key === active;
        return (
          <Link key={key} href={`${base}?date=${key}${extra}`} aria-current={on ? "date" : undefined}
            className={cn("focus-ring flex w-14 shrink-0 flex-col items-center rounded-xl border py-1.5 transition-colors duration-200",
              on ? "border-edge/50 bg-edge/10 text-edge" : "hairline text-slate-300 hover:bg-white/[0.04]")}>
            <span className="text-[10px] opacity-70">{i === 0 ? "Today" : formatInTimeZone(d, TZ, "EEE")}</span>
            <span className="num text-sm">{formatInTimeZone(d, TZ, "d")}</span>
          </Link>
        );
      })}
    </nav>
  );
}
