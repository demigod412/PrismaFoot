import Link from "next/link";
import { getBoard, getLeagues } from "@/lib/queries";
import { dayKey, fmtWat, isDayKey, watDayStart } from "@/lib/time";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { DateNav } from "@/components/DateNav";
import { FixtureList } from "@/components/FixtureList";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Chip } from "@/components/ui";
import { scan, DEFAULT_FLOORS, type ScannerSlug } from "@/lib/scanners";

export const metadata = { title: "Fixtures" };
const MARKETS: { slug: ScannerSlug; label: string }[] = [
  { slug: "all", label: "All" }, { slug: "win", label: "Win" }, { slug: "o15", label: "O1.5" }, { slug: "o25", label: "O2.5" },
  { slug: "dc", label: "Double chance" }, { slug: "btts", label: "BTTS" }, { slug: "bttsno", label: "BTTS No" }, { slug: "by2", label: "Win by 2+" },
  { slug: "corners", label: "Corners" }, { slug: "shots", label: "Shots" }, { slug: "u25", label: "U2.5" }, { slug: "u35", label: "U3.5" }, { slug: "u45", label: "U4.5" },
  { slug: "h1u15", label: "1H U1.5" }, { slug: "h1u25", label: "1H U2.5" }, { slug: "h2u25", label: "2H U2.5" }, { slug: "winover", label: "Win or O2.5" },
  { slug: "draw", label: "Draw" }, { slug: "safe", label: "Safe" },
];

export default async function Fixtures({ searchParams }: { searchParams: Promise<{ date?: string; league?: string; market?: string }> }) {
  const sp = await searchParams;
  const date = isDayKey(sp.date) ? sp.date : dayKey(new Date());
  const market = (MARKETS.find((m) => m.slug === sp.market)?.slug ?? "all") as ScannerSlug;
  const from = watDayStart(date);
  const [leagues, all] = await Promise.all([getLeagues(), getBoard({ from, to: new Date(from.getTime() + 86_400_000), leagueId: sp.league })]);
  // Empty day: point to the nearest day that has fixtures (e.g. during international breaks)
  const nextDay = all.length ? null : await (async () => {
    const { provider } = await dataMode();
    const f = await prisma.fixture.findFirst({ where: { provider, kickoffUtc: { gte: new Date(from.getTime() + 86_400_000) }, ...(sp.league ? { leagueId: sp.league } : {}) }, orderBy: { kickoffUtc: "asc" }, select: { kickoffUtc: true } });
    return f ? dayKey(f.kickoffUtc) : null;
  })();
  const picks = new Map<string, { label: string; p: number }>();
  const shown = all.filter((f) => {
    const p = f.predictions[0]; if (!p) return market === "all";
    const k = scan(market, p, DEFAULT_FLOORS); if (k && market !== "all") picks.set(f.id, k);
    return !!k;
  });
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ date, league: sp.league, market, ...o }).filter(([, v]) => v && v !== "all") as [string, string][]).toString();

  return (
    <PullToRefresh>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Fixtures</h1>
      <DateNav active={date} base="/fixtures" extra={`${sp.league ? `&league=${sp.league}` : ""}${market !== "all" ? `&market=${market}` : ""}`} />
      <div data-no-ptr className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        <Link href={q({ league: undefined })}><Chip active={!sp.league}>All leagues</Chip></Link>
        {leagues.map((l) => <Link key={l.id} href={q({ league: l.id })}><Chip active={sp.league === l.id}>{l.name}</Chip></Link>)}
      </div>
      <div data-no-ptr className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        {MARKETS.map((m) => <Link key={m.slug} href={q({ market: m.slug })}><Chip active={market === m.slug}>{m.label}</Chip></Link>)}
      </div>
      {shown.length ? <FixtureList fixtures={shown} picks={picks} />
        : all.length
          ? <EmptyState title="Nothing matches this filter" body="Fixtures exist on this date, but none pass the selected market floor." action={{ href: q({ market: "all" }), label: "Show all markets" }} />
          : <EmptyState title="No fixtures on this date" body={nextDay ? `Next matches: ${fmtWat(watDayStart(nextDay), "EEEE d MMMM")}. Leagues pause during international breaks.` : "No upcoming fixtures are stored for the selected leagues."}
              action={nextDay ? { href: `/fixtures?date=${nextDay}${sp.league ? `&league=${sp.league}` : ""}`, label: "Go to next match day" } : undefined} />}
    </PullToRefresh>
  );
}
