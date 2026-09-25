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
export default async function Home({ searchParams }: { searchParams: Promise<{ date?: string; league?: string; market?: string }> }) {
  const sp = await searchParams;
  const zone = await tz();
  const date = isDayKey(sp.date) ? sp.date : dayKeyIn(new Date(), zone);
  const market = (MARKETS.find((m) => m.slug === sp.market)?.slug ?? "all") as ScannerSlug;
  const from = dayStart(date, zone);
  const [leagues, all] = await Promise.all([getLeagues(), getBoard({ from, to: new Date(from.getTime() + 86_400_000), leagueId: sp.league })]);
  // Empty day: point to the nearest day that has fixtures (e.g. during international breaks)
  const nextDay = all.length ? null : await (async () => {
    const { provider } = await dataMode();
    const f = await prisma.fixture.findFirst({ where: { provider, kickoffUtc: { gte: new Date(from.getTime() + 86_400_000) }, ...(sp.league ? { leagueId: sp.league } : {}) }, orderBy: { kickoffUtc: "asc" }, select: { kickoffUtc: true } });
    return f ? dayKeyIn(f.kickoffUtc, zone) : null;
  })();
  const picks = new Map<string, { label: string; p: number }>();
  const shown = all.filter((f) => {
    const p = f.predictions[0]; if (!p) return market === "all";
    const k = scan(market, p, DEFAULT_FLOORS); if (k && market !== "all") picks.set(f.id, k);
    return !!k;
  });
  const q = (o: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ date, league: sp.league, market, ...o }).filter(([, v]) => v && v !== "all") as [string, string][]).toString();
    return s ? `?${s}` : "";
  };

  return (
    <PullToRefresh>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Fixtures</h1>
      <DateNav active={date} base="/" extra={`${sp.league ? `&league=${sp.league}` : ""}${market !== "all" ? `&market=${market}` : ""}`} />
      <div data-no-ptr className="mb-5 grid gap-2 sm:grid-cols-2">
        <FilterSelect label="League" value={sp.league ?? "all"}
          options={[{ value: "all", label: `All leagues (${leagues.length})`, href: `/${q({ league: undefined })}` },
            ...leagues.map((l) => ({ value: l.id, label: l.name, group: l.country, href: `/${q({ league: l.id })}` }))]} />
        <FilterSelect label="Market" value={market} options={MARKETS.map((m) => ({ value: m.slug, label: m.label, group: m.group, href: `/${q({ market: m.slug })}` }))} />
      </div>
      {shown.length ? <FixtureList fixtures={shown} picks={picks} />
        : all.length
          ? <EmptyState title="Nothing matches this filter" body="Fixtures exist on this date, but none pass the selected market floor." action={{ href: q({ market: "all" }) || "/", label: "Show all markets" }} />
          : <EmptyState title="No fixtures on this date" body={nextDay ? `Next matches: ${fmtIn(dayStart(nextDay, zone), zone, "EEEE d MMMM")}. Leagues pause during international breaks.` : "No upcoming fixtures are stored for the selected leagues."}
              action={nextDay ? { href: `/?date=${nextDay}${sp.league ? `&league=${sp.league}` : ""}`, label: "Go to next match day" } : undefined} />}
    </PullToRefresh>
  );
}
