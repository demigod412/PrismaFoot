import Link from "next/link";
import { next48h } from "@/lib/queries";
import { FixtureList } from "@/components/FixtureList";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SCANNERS, scan, DEFAULT_FLOORS } from "@/lib/scanners";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";

export default async function Home() {
  const [fixtures, mode] = await Promise.all([next48h(), dataMode()]);
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
          {SCANNERS.filter((s) => ["safe", "win", "o25", "u25", "btts", "o15", "u35", "draw"].includes(s.slug)).map((s) => (
            <Link key={s.slug} href={`/scanner/${s.slug}`} className="focus-ring glass shrink-0 !rounded-xl px-3 py-2 text-sm transition-colors duration-200 hover:border-edge/40">
              {s.name} <span className="num ml-1 text-edge">{counts[s.slug] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <Link href="/accuracy" className="focus-ring glass !rounded-xl px-3 py-2 text-sm">
          <span className="text-slate-400">Accuracy ledger</span>{" "}
          <span className="num text-slate-100">{settled}</span> <span className="text-slate-400">settled calls</span>
        </Link>
      </div>

      {fixtures.length === 0 ? (
        <EmptyState title="No fixtures in the next 48 hours"
          body={mode.demo ? "Seed demo data with npm run db:seed, or add a data key." : "Leagues on the allowlist have no matches in this window. Check the 14-day board."}
          action={{ href: "/fixtures", label: "Open the 14-day board" }} />
      ) : <FixtureList fixtures={fixtures} />}
    </PullToRefresh>
  );
}
