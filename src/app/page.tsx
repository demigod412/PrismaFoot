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
  const { provider } = await dataMode();
  /*
   * Nearest day that actually has fixtures for this filter, looking forward first and then back.
   *
   * Forward only stranded any competition whose season has ended: it has nothing ahead, so the board
   * showed "no fixtures" with nothing to click even when hundreds of played matches were stored.
   * Jumping backwards also switches the tab to Finished, since every match on a past day is finished
   * and landing on an empty Upcoming tab would be the same dead end one date further on.
   */
  const nearest = all.length ? null : await (async () => {
    const where = { provider, ...(sp.league ? { leagueId: sp.league } : {}) };
    const ahead = await prisma.fixture.findFirst({
      where: { ...where, kickoffUtc: { gte: new Date(from.getTime() + 86_400_000) } },
      orderBy: { kickoffUtc: "asc" }, select: { kickoffUtc: true },
    });
    if (ahead) return { day: dayKeyIn(ahead.kickoffUtc, zone), dir: "next" as const };
    const behind = await prisma.fixture.findFirst({
      where: { ...where, kickoffUtc: { lt: from } },
      orderBy: { kickoffUtc: "desc" }, select: { kickoffUtc: true },
    });
    return behind ? { day: dayKeyIn(behind.kickoffUtc, zone), dir: "prev" as const } : null;
  })();
  const jump = nearest
    ? { href: `/?date=${nearest.day}${sp.league ? `&league=${sp.league}` : ""}${nearest.dir === "prev" ? "&show=finished" : ""}`,
        label: nearest.dir === "next" ? "Go to next match day" : "Go to the last match day" }
    : undefined;
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

  /*
   * Which leagues still have fixtures ahead, and when each last played. Two grouped queries for the
   * whole provider rather than one per league, so the filter can send you somewhere with fixtures
   * instead of somewhere empty.
   */
  const [aheadRows, behindRows] = await Promise.all([
    prisma.fixture.groupBy({ by: ["leagueId"], where: { provider, kickoffUtc: { gte: now } }, _count: { _all: true } }),
    prisma.fixture.groupBy({ by: ["leagueId"], where: { provider, kickoffUtc: { lt: now } }, _max: { kickoffUtc: true } }),
  ]);
  const hasAhead = new Set(aheadRows.map((r) => r.leagueId));
  const lastPlayed = new Map(behindRows.flatMap((r) => (r._max.kickoffUtc ? [[r.leagueId, r._max.kickoffUtc] as const] : [])));
  /** Where picking this league should take you: its own last match day once its season is over. */
  const leagueHref = (id: string) => {
    if (hasAhead.has(id)) return q({ league: id });                       // still playing: keep the date
    const last = lastPlayed.get(id);
    return last ? q({ league: id, date: dayKeyIn(last, zone), show: "finished" }) : q({ league: id });
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
            ...leagues.map((l) => ({
              value: l.id,
              // Marked so a competition between seasons is obviously that, not obviously broken.
              label: hasAhead.has(l.id) ? l.name : `${l.name} · ended`,
              group: l.country, href: `/${leagueHref(l.id)}`,
            }))]} />
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
            : <EmptyState title="No fixtures on this date"
                body={nearest?.dir === "next" ? `Next matches: ${fmtIn(dayStart(nearest.day, zone), zone, "EEEE d MMMM")}. Leagues pause during international breaks.`
                  : nearest?.dir === "prev" ? `Nothing scheduled ahead for this selection — its season looks finished. The last matches were on ${fmtIn(dayStart(nearest.day, zone), zone, "EEEE d MMMM")}.`
                  : "No fixtures are stored for this selection yet. They appear after the next sync."}
                action={jump} />}
    </PullToRefresh>
  );
}
