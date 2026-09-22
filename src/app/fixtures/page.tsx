import Link from "next/link";
import { getBoard, getLeagues } from "@/lib/queries";
import { dayKey, watDayStart } from "@/lib/time";
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
  { slug: "draw", label: "Draw" }, { slug: "safe", label: "Safe" },
];

export default async function Fixtures({ searchParams }: { searchParams: Promise<{ date?: string; league?: string; market?: string }> }) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : dayKey(new Date());
  const market = (MARKETS.find((m) => m.slug === sp.market)?.slug ?? "all") as ScannerSlug;
  const from = watDayStart(date);
  const [leagues, all] = await Promise.all([getLeagues(), getBoard({ from, to: new Date(from.getTime() + 86_400_000), leagueId: sp.league })]);
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
        : <EmptyState title="Nothing matches this filter" body={all.length ? "Fixtures exist on this date, but none pass the selected market floor." : "No fixtures on this date for the selected leagues."}
            action={all.length ? { href: q({ market: "all" }), label: "Show all markets" } : undefined} />}
    </PullToRefresh>
  );
}
