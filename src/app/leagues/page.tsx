import Link from "next/link";
import { getLeagues } from "@/lib/queries";
import { EmptyState } from "@/components/EmptyState";
export const metadata = { title: "Leagues" };
export default async function Leagues() {
  const leagues = await getLeagues();
  if (!leagues.length) return <EmptyState title="No leagues yet" body="Run the demo seed or an ingest to load leagues." action={{ href: "/settings", label: "Open settings" }} />;
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Leagues</h1>
      <ul className="grid gap-2 sm:grid-cols-2">
        {leagues.map((l) => (
          <li key={l.id}>
            <Link href={`/league/${l.id}`} className="focus-ring glass block p-4 hover:border-edge/30">
              <div className="text-sm font-medium">{l.name}</div>
              <div className="text-xs text-slate-400">{l.country} · season {l.season}</div>
              <div className="num mt-2 text-[11px] text-slate-500">home factor {l.homeAdv.toFixed(2)}  ρ {l.rho.toFixed(3)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
