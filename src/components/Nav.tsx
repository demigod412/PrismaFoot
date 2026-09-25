"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, LayoutGrid, Radar, Ticket, Menu, LineChart, BookOpen, Settings, Trophy, Calculator } from "lucide-react";
import { cn } from "./ui";

const TABS = [
  { href: "/", label: "Fixtures", icon: CalendarDays, match: (p: string) => p === "/" || p.startsWith("/fixtures") || p.startsWith("/match") },
  { href: "/top", label: "Top 50", icon: Trophy, match: (p: string) => p.startsWith("/top") },
  { href: "/builder", label: "Builder", icon: Calculator, match: (p: string) => p.startsWith("/builder") },
  { href: "/scanner", label: "Scanners", icon: Radar, match: (p: string) => p.startsWith("/scanner") },
  { href: "/slips", label: "Slips", icon: Ticket, match: (p: string) => p.startsWith("/slips") },
  { href: "/more", label: "More", icon: Menu, match: (p: string) => ["/more", "/accuracy", "/methodology", "/settings", "/league"].some((x) => p.startsWith(x)) },
];

export function BottomTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t hairline bg-ink-950/90 backdrop-blur md:hidden">
      <ul className="grid grid-cols-6">
        {TABS.map((t) => {
          const on = t.match(path);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={on ? "page" : undefined}
                className={cn("focus-ring flex flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors duration-200", on ? "text-edge" : "text-slate-400")}>
                <t.icon size={20} strokeWidth={on ? 2.2 : 1.7} />{t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LeftRail({ leagues }: { leagues: { id: string; name: string; country: string }[] }) {
  const path = usePathname();
  const item = (href: string, label: string, Icon: typeof CalendarDays, on: boolean) => (
    <Link key={href} href={href} aria-current={on ? "page" : undefined}
      className={cn("focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-200",
        on ? "bg-edge/10 text-edge" : "text-slate-300 hover:bg-white/[0.04]")}>
      <Icon size={16} />{label}
    </Link>
  );
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r hairline px-3 py-5 md:flex">
      <Link href="/" className="focus-ring flex items-baseline gap-1 px-2.5 text-lg font-semibold tracking-tight">
        Pitch<span className="text-edge">Edge</span>
      </Link>
      <nav aria-label="Primary" className="space-y-0.5">
        {item("/", "Fixtures", CalendarDays, path === "/" || path.startsWith("/fixtures"))}
        {item("/top", "Top 50 tips", Trophy, path.startsWith("/top"))}
        {item("/leagues", "Leagues", LayoutGrid, path.startsWith("/leagues"))}
        {item("/builder", "Odds builder", Calculator, path.startsWith("/builder"))}
        {item("/scanner", "Scanners", Radar, path.startsWith("/scanner"))}
        {item("/slips", "Slips", Ticket, path.startsWith("/slips"))}
        {item("/accuracy", "Accuracy", LineChart, path.startsWith("/accuracy"))}
        {item("/methodology", "Methodology", BookOpen, path.startsWith("/methodology"))}
        {item("/settings", "Settings", Settings, path.startsWith("/settings"))}
      </nav>
      <div>
        <div className="flex items-baseline justify-between px-2.5 pb-2 text-xs text-slate-500">
          <span>Leagues</span>
          {leagues.length > 12 && <Link href="/leagues" className="focus-ring text-[11px] text-slate-400 hover:text-edge">all {leagues.length}</Link>}
        </div>
        <ul className="space-y-0.5">
          {leagues.slice(0, 12).map((l) => (
            <li key={l.id}>
              <Link href={`/league/${l.id}`} className={cn("focus-ring block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-200",
                path === `/league/${l.id}` ? "bg-white/[0.06] text-slate-100" : "text-slate-400 hover:text-slate-200")}>
                {l.name}<span className="ml-1 text-slate-600">{l.country}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
