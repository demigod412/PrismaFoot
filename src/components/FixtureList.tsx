import type { BoardFixture } from "@/lib/queries";
import { MatchRow } from "./MatchRow";

/** Groups fixtures by league (league order = first kickoff). */
export function FixtureList({ fixtures, picks }: { fixtures: BoardFixture[]; picks?: Map<string, { label: string; p: number }> }) {
  const groups = new Map<string, BoardFixture[]>();
  fixtures.forEach((f) => groups.set(f.leagueId, [...(groups.get(f.leagueId) ?? []), f]));
  return (
    <div className="space-y-4">
      {[...groups.values()].map((g) => (
        <section key={g[0].leagueId} className="glass px-1 py-2">
          <h3 className="px-3 pb-1 pt-1 text-xs text-slate-400">{g[0].league.name} <span className="text-slate-600">{g[0].league.country}</span></h3>
          <div className="divide-y divide-white/[0.05]">
            {g.map((f) => <MatchRow key={f.id} fx={f} pick={picks?.get(f.id)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
