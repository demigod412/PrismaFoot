import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBoard } from "@/lib/queries";
import { FixtureList } from "@/components/FixtureList";
import { Card, SectionTitle } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const league = await prisma.league.findUnique({ where: { id } });
  if (!league) notFound();
  const now = new Date();
  const [upcoming, finished, ratings] = await Promise.all([
    getBoard({ from: now, to: new Date(now.getTime() + 14 * 86_400_000), leagueId: id }),
    prisma.fixture.findMany({ where: { leagueId: id, status: "FINISHED" }, include: { homeTeam: true, awayTeam: true } }),
    prisma.teamRatingSnapshot.findMany({ where: { team: { leagueId: id } }, orderBy: { asOf: "desc" }, distinct: ["teamId"], include: { team: true } }),
  ]);
  // Table computed from stored results (provider standings are Phase 3).
  const table = new Map<string, { name: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }>();
  const row = (tid: string, name: string) => table.get(tid) ?? table.set(tid, { name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }).get(tid)!;
  finished.forEach((f) => {
    const h = row(f.homeTeamId, f.homeTeam.name), a = row(f.awayTeamId, f.awayTeam.name);
    const hg = f.homeGoals ?? 0, ag = f.awayGoals ?? 0;
    h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.w++; a.l++; h.pts += 3; } else if (hg < ag) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
  });
  const rows = [...table.entries()].sort(([, x], [, y]) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
  const rating = new Map(ratings.map((r) => [r.teamId, r]));

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{league.name}</h1>
      <p className="mb-6 text-sm text-slate-400">{league.country} · season {league.season} · home factor <span className="num">{league.homeAdv.toFixed(2)}</span> · ρ <span className="num">{league.rho.toFixed(3)}</span></p>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          <SectionTitle>Next 14 days</SectionTitle>
          {upcoming.length ? <FixtureList fixtures={upcoming} /> : <EmptyState title="No upcoming fixtures" body="Nothing scheduled in the 14-day window." />}
        </div>
        <Card className="h-fit">
          <SectionTitle aside="α attack · β defence">Table and ratings</SectionTitle>
          <div className="overflow-x-auto">
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">#</th><th className="text-left font-normal">Club</th><th className="font-normal">P</th><th className="font-normal">GD</th><th className="font-normal">Pts</th><th className="font-normal">α</th><th className="font-normal">β</th></tr></thead>
              <tbody>
                {rows.map(([tid, r], i) => (
                  <tr key={tid} className="border-t hairline">
                    <td className="py-1.5 text-slate-500">{i + 1}</td>
                    <td className="max-w-[9rem] truncate font-sans text-slate-200">{r.name}</td>
                    <td className="text-center">{r.p}</td><td className="text-center">{r.gf - r.ga}</td>
                    <td className="text-center text-slate-100">{r.pts}</td>
                    <td className="text-center text-edge">{rating.get(tid)?.attack.toFixed(2) ?? "–"}</td>
                    <td className="text-center text-ice">{rating.get(tid)?.defence.toFixed(2) ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
