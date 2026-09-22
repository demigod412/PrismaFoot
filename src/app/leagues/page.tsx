import Link from "next/link";
import { getLeagues } from "@/lib/queries";
import { EmptyState } from "@/components/EmptyState";
import { Chip } from "@/components/ui";

export const metadata = { title: "Leagues" };
export const dynamic = "force-dynamic";

/** Leagues grouped by country, collapsed by default, so a 50-league list stays readable on a phone. */
export default async function Leagues({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const all = await getLeagues();
  if (!all.length) return <EmptyState title="No leagues yet" body="Run the demo seed or a sync to load leagues." action={{ href: "/settings", label: "Open settings" }} />;
  const q = (sp.q ?? "").toLowerCase();
  const leagues = q ? all.filter((l) => `${l.name} ${l.country}`.toLowerCase().includes(q)) : all;
  const byCountry = new Map<string, typeof leagues>();
  for (const l of leagues) byCountry.set(l.country, [...(byCountry.get(l.country) ?? []), l]);
  const countries = [...byCountry.keys()].sort((a, b) => a.localeCompare(b));
  const letters = [...new Set(countries.map((c) => c[0]?.toUpperCase()))].slice(0, 12);

  return (
    <>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Leagues <span className="num text-base text-slate-500">{all.length}</span></h1>
        {q && <Link href="/leagues" className="text-xs text-slate-400 underline underline-offset-2">Clear filter</Link>}
      </header>
      <nav aria-label="Jump to" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <Link href="/leagues"><Chip active={!q}>All</Chip></Link>
        {letters.map((c) => <Link key={c} href={`/leagues?q=${c}`}><Chip active={q === c.toLowerCase()}>{c}</Chip></Link>)}
      </nav>
      {countries.length === 0 ? <EmptyState title="Nothing matches" body="No league or country matches that filter." action={{ href: "/leagues", label: "Show all" }} /> : (
        <div className="space-y-2">
          {countries.map((c) => {
            const rows = byCountry.get(c)!;
            return (
              <details key={c} open={countries.length <= 6 || !!q} className="glass px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{c}</span><span className="num text-xs text-slate-500">{rows.length}</span>
                </summary>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {rows.map((l) => (
                    <li key={l.id}>
                      <Link href={`/league/${l.id}`} className="focus-ring block rounded-lg border hairline bg-white/[0.02] px-3 py-2 hover:border-edge/30">
                        <div className="truncate text-sm">{l.name}</div>
                        <div className="num text-[11px] text-slate-500">season {l.season} · home factor {l.homeAdv.toFixed(2)} · ρ {l.rho.toFixed(3)}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
