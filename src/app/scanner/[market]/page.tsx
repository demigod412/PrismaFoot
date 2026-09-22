import { notFound } from "next/navigation";
import Link from "next/link";
import { getBoard } from "@/lib/queries";
import { SCANNERS, scan, DEFAULT_FLOORS, type ScannerFloors, type ScannerSlug } from "@/lib/scanners";
import { getSetting } from "@/lib/secrets";
import { FixtureList } from "@/components/FixtureList";
import { EmptyState } from "@/components/EmptyState";
import { Chip } from "@/components/ui";
import { BlendBuilder, type BlendCandidate } from "@/components/BlendBuilder";
import { fmtWat } from "@/lib/time";

export default async function ScannerPage({ params, searchParams }: { params: Promise<{ market: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { market } = await params; const { focus } = await searchParams;
  const def = SCANNERS.find((s) => s.slug === market);
  if (!def) notFound();
  const floors = { ...DEFAULT_FLOORS, ...(await getSetting<Partial<ScannerFloors>>("scannerFloors", {})) };
  const now = new Date();
  const fixtures = (await getBoard({ from: now, to: new Date(now.getTime() + 14 * 86_400_000), focus })).filter((f) => f.predictions[0]);
  const focusChips = (
    <div className="mb-4 flex gap-1.5">
      {[[undefined, "All leagues"], ["europe-strong", "Europe strongest"], ["england", "England"], ["international", "International"]].map(([f, l]) => (
        <Link key={l} href={f ? `?focus=${f}` : "?"}><Chip active={focus === f}>{l}</Chip></Link>
      ))}
    </div>
  );

  if (def.slug === "blend") {
    const cands: BlendCandidate[] = fixtures.map((f) => {
      const p = f.predictions[0];
      return { id: f.id, title: `${f.homeTeam.shortName ?? f.homeTeam.name} v ${f.awayTeam.shortName ?? f.awayTeam.name}`, when: fmtWat(f.kickoffUtc, "EEE HH:mm"), band: p.band,
        markets: { "Home win": p.calHome, Draw: p.calDraw, "Away win": p.calAway, "Over 1.5": p.calOver15, "Over 2.5": p.calOver25, "Under 2.5": 1 - p.calOver25, "Under 3.5": 1 - p.calOver35, "Under 4.5": 1 - p.calOver45, BTTS: p.calBtts } };
    });
    return (<><Header name={def.name} blurb={def.blurb} n={cands.length} />{focusChips}<BlendBuilder candidates={cands} /></>);
  }

  const picks = new Map<string, { label: string; p: number }>();
  const hits = fixtures.filter((f) => { const k = scan(def.slug as ScannerSlug, f.predictions[0], floors); if (k) picks.set(f.id, k); return !!k; });
  if (def.slug !== "all") hits.sort((a, b) => picks.get(b.id)!.p - picks.get(a.id)!.p);

  return (
    <>
      <Header name={def.name} blurb={def.blurb} n={hits.length} />
      {focusChips}
      {hits.length ? <FixtureList fixtures={hits} picks={def.slug === "all" ? undefined : picks} />
        : <EmptyState title={`No ${def.name} picks in the next 14 days`} body="Nothing clears the current floor. That is a valid answer; lowering the floor in Settings trades accuracy for volume." action={{ href: "/settings", label: "Adjust floors" }} />}
    </>
  );
}

function Header({ name, blurb, n }: { name: string; blurb: string; n: number }) {
  return (
    <header className="mb-4">
      <Link href="/scanner" className="text-xs text-slate-400 hover:text-slate-200">Scanners</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{name} <span className="num text-base text-slate-500">{n}</span></h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-400">{blurb}</p>
    </header>
  );
}
