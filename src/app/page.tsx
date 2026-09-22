import Link from "next/link";
import { next48h } from "@/lib/queries";
import { FixtureList } from "@/components/FixtureList";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SCANNERS, scan, DEFAULT_FLOORS } from "@/lib/scanners";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { dayKey, fmtWat } from "@/lib/time";

export default async function Home() {
  const [fixtures, mode] = await Promise.all([next48h(), dataMode()]);
  const nextUp = fixtures.length ? null : await prisma.fixture.findFirst({ where: { provider: mode.provider, status: "SCHEDULED", kickoffUtc: { gt: new Date() } }, orderBy: { kickoffUtc: "asc" }, include: { league: true } });
  const settled = await prisma.prediction.count({ where: { lockedAt: { not: null }, fixture: { provider: mode.provider, status: "FINISHED" } } });
  const withCalls = fixtures.filter((f) => f.predictions[0]);
  const counts = Object.fromEntries(SCANNERS.filter((s) => s.slug !== "all" && s.slug !== "blend")
    .map((s) => [s.slug, withCalls.filter((f) => scan(s.slug, f.predictions[0], DEFAULT_FLOORS)).length]));

  return (
    <PullToRefresh>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Next 48 hours</h1>
        <p className="mt-1 text-sm text-slate-400">{withCalls.length} fixtures with a model call. Kickoffs in WAT, UTC underneath.</p>
      </header>

      <div className="mb-6 grid gap-3 md:grid-cols-[1fr_16rem]">
        <nav aria-label="Scanner shortcuts" className="flex gap-2 overflow-x-auto pb-1">
          <Link href="/top" className="focus-ring glass hidden shrink-0 !rounded-xl border-edge/40 px-3 py-2 text-sm text-edge md:block">Top 20</Link>
          {SCANNERS.filter((s) => ["safe", "win", "dc", "o25", "u25", "btts", "bttsno", "by2", "corners", "shots"].includes(s.slug)).map((s) => (
            <Link key={s.slug} href={`/scanner/${s.slug}`} className="focus-ring glass shrink-0 !rounded-xl px-3 py-2 text-sm transition-colors duration-200 hover:border-edge/40">
              {s.name} <span className="num ml-1 text-edge">{counts[s.slug] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <Link href="/top" className="focus-ring glass !rounded-xl border-edge/30 px-3 py-2 text-sm md:hidden">
          <span className="text-edge">Top 20 tips</span> <span className="text-slate-400">today → next 7 days</span>
        </Link>
        <Link href="/accuracy" className="focus-ring glass !rounded-xl px-3 py-2 text-sm">
          <span className="text-slate-400">Accuracy ledger</span>{" "}
          <span className="num text-slate-100">{settled}</span> <span className="text-slate-400">settled calls</span>
        </Link>
      </div>

      {fixtures.length === 0 ? (
        <EmptyState title="No fixtures in the next 48 hours"
          body={nextUp ? `Next match: ${nextUp.league.name}, ${fmtWat(nextUp.kickoffUtc, "EEE d MMM, HH:mm")} WAT. Leagues pause during international breaks.` : mode.demo ? "Seed demo data with npm run db:seed, or add a data key." : "No upcoming fixtures are stored yet. They appear after the next sync."}
          action={nextUp ? { href: `/fixtures?date=${dayKey(nextUp.kickoffUtc)}`, label: "Go to that day" } : { href: "/fixtures", label: "Open the fixtures board" }} />
      ) : <FixtureList fixtures={fixtures} />}
    </PullToRefresh>
  );
}
