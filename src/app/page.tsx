import Link from "next/link";
import { getBoard, getLeagues } from "@/lib/queries";
import { dayKeyIn, dayStart, fmtIn, isDayKey } from "@/lib/time";
import { tz } from "@/lib/tz";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { DateNav } from "@/components/DateNav";
import { FixtureList } from "@/components/FixtureList";
import { FilterSelect } from "@/components/FilterSelect";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { scan, DEFAULT_FLOORS, type ScannerSlug } from "@/lib/scanners";
import { countViews, fixtureView, isFixtureView, FIXTURE_VIEWS, VIEW_LABEL } from "@/lib/fixtureView";
import { cn } from "@/components/ui";

export const metadata = { title: "Fixtures" };
const MARKETS: { slug: ScannerSlug; label: string; group: string }[] = [
  { slug: "all", label: "All markets", group: "" },
  { slug: "win", label: "Win", group: "Result" }, { slug: "dc", label: "Double chance", group: "Result" }, { slug: "draw", label: "Draw", group: "Result" },
  { slug: "winover", label: "Win or Over 2.5", group: "Result" }, { slug: "by2", label: "Win by 2+", group: "Result" },
  { slug: "o15", label: "Over 1.5", group: "Goals" }, { slug: "o25", label: "Over 2.5", group: "Goals" }, { slug: "u25", label: "Under 2.5", group: "Goals" },
  { slug: "u35", label: "Under 3.5", group: "Goals" }, { slug: "u45", label: "Under 4.5", group: "Goals" },
  { slug: "btts", label: "Both teams to score", group: "Goals" }, { slug: "bttsno", label: "BTTS No", group: "Goals" },
  { slug: "h1u15", label: "1st half Under 1.5", group: "Halves" }, { slug: "h1u25", label: "1st half Under 2.5", group: "Halves" },
  { slug: "h2u25", label: "2nd half Under 2.5", group: "Halves" }, { slug: "htdraw", label: "Half-time draw", group: "Halves" },
  { slug: "corners", label: "Corners", group: "Stats" }, { slug: "shots", label: "Total shots", group: "Stats" },
  { slug: "safe", label: "Safe picks", group: "Other" },
];

/** The fixtures board is the landing page: a date strip, two filters and the matches for that day. */
export default async function Home({ searchParams }: { searchParams: Promise<{ date?: string; league?: string; market?: string; show?: string }> }) {
  const sp = await searchParams;
  const zone = await tz();
  const now = new Date();
  // Upcoming by default: the board's job is the matches you can still bet on.
  const show = isFixtureView(sp.show) ? sp.show : "upcoming";
  const date = isDayKey(sp.date) ? sp.date : dayKeyIn(now, zone);
  const market = (MARKETS.find((m) => m.slug === sp.market)?.slug ?? "all") as ScannerSlug;
  const from = dayStart(date, zone);
  const [leagues, all] = await Promise.all([getLeagues(), getBoard({ from, to: new Date(from.getTime() + 86_400_000), leagueId: sp.league })]);
  // Empty day: point to the nearest day that has fixtures (e.g. during international breaks)
  const nextDay = all.length ? null : await (async () => {
    const { provider } = await dataMode();
    const f = await prisma.fixture.findFirst({ where: { provider, kickoffUtc: { gte: new Date(from.getTime() + 86_400_000) }, ...(sp.league ? { leagueId: sp.league } : {}) }, orderBy: { kickoffUtc: "asc" }, select: { kickoffUtc: true } });
    return f ? dayKeyIn(f.kickoffUtc, zone) : null;
  })();
  // Counted before the market filter, so the tab numbers describe the day rather than the filter.
  const counts = countViews(all, now);
  const inView = all.filter((f) => fixtureView(f, now) === show);
  const picks = new Map<string, { label: string; p: number }>();
  const shown = inView.filter((f) => {
    const p = f.predictions[0]; if (!p) return market === "all";
    const k = scan(market, p, DEFAULT_FLOORS); if (k && market !== "all") picks.set(f.id, k);
    return !!k;
  });
  const q = (o: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ date, league: sp.league, market, show, ...o })
      .filter(([k, v]) => v && v !== "all" && !(k === "show" && v === "upcoming")) as [string, string][]).toString();
    return s ? `?${s}` : "";
  };

  return (
    <PullToRefresh>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Fixtures</h1>
      <DateNav active={date} base="/" extra={`${sp.league ? `&league=${sp.league}` : ""}${market !== "all" ? `&market=${market}` : ""}`} />
      <div data-no-ptr className="mb-3 inline-flex rounded-xl border hairline p-1">
        {FIXTURE_VIEWS.map((v) => (
          <Link key={v} href={`/${q({ show: v })}`} aria-current={show === v ? "page" : undefined}
            className={cn("focus-ring rounded-lg px-3 py-1.5 text-sm transition-colors duration-200", show === v ? "bg-edge text-ink-950" : "text-slate-300 hover:text-slate-100")}>
            {VIEW_LABEL[v]}
            <span className={cn("num ml-1.5 text-[11px]", show === v ? "text-ink-950/60" : "text-slate-500")}>{counts[v]}</span>
            {v === "live" && counts.live > 0 && <span aria-hidden className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-miss align-middle" />}
          </Link>
        ))}
      </div>
      {counts.off > 0 && (
        <p className="mb-3 text-[11px] text-slate-500">{counts.off} postponed or cancelled on this date, not shown in any tab.</p>
      )}
      <div data-no-ptr className="mb-5 grid gap-2 sm:grid-cols-2">
        <FilterSelect label="League" value={sp.league ?? "all"}
          options={[{ value: "all", label: `All leagues (${leagues.length})`, href: `/${q({ league: undefined })}` },
            ...leagues.map((l) => ({ value: l.id, label: l.name, group: l.country, href: `/${q({ league: l.id })}` }))]} />
        <FilterSelect label="Market" value={market} options={MARKETS.map((m) => ({ value: m.slug, label: m.label, group: m.group, href: `/${q({ market: m.slug })}` }))} />
      </div>
      {shown.length ? <FixtureList fixtures={shown} picks={picks} />
        : inView.length
          ? <EmptyState title="Nothing matches this filter" body={`${inView.length} ${VIEW_LABEL[show].toLowerCase()} ${inView.length === 1 ? "match" : "matches"} on this date, but none pass the selected market floor.`} action={{ href: q({ market: "all" }) || "/", label: "Show all markets" }} />
          : all.length
            // The day has matches, just none in this tab — point at the tab that does.
            ? <EmptyState title={`No ${VIEW_LABEL[show].toLowerCase()} matches on this date`}
                body={`This date has ${FIXTURE_VIEWS.filter((v) => counts[v] > 0).map((v) => `${counts[v]} ${VIEW_LABEL[v].toLowerCase()}`).join(" and ") || "nothing playable"}.`}
                action={(() => { const other = FIXTURE_VIEWS.find((v) => v !== show && counts[v] > 0); return other ? { href: q({ show: other }) || "/", label: `Show ${VIEW_LABEL[other].toLowerCase()}` } : undefined; })()} />
            : <EmptyState title="No fixtures on this date" body={nextDay ? `Next matches: ${fmtIn(dayStart(nextDay, zone), zone, "EEEE d MMMM")}. Leagues pause during international breaks.` : "No upcoming fixtures are stored for the selected leagues."}
                action={nextDay ? { href: `/?date=${nextDay}${sp.league ? `&league=${sp.league}` : ""}`, label: "Go to next match day" } : undefined} />}
    </PullToRefresh>
  );
}
