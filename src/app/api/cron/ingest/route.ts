import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPrimaryProvider, PROVIDER_ENUM } from "@/lib/providers";
import { ingest } from "@/lib/pipeline/ingest";
import { lockDue, settle, snapshotAccuracy, syncResults } from "@/lib/pipeline/ledger";
import type { Provider } from "@prisma/client";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Scheduled jobs (protected by CRON_SECRET):
 *   (default)      every 3h  — fixtures, stats, odds → rate → predict → lock → settle → calibrate → accuracy
 *   ?job=lock      every 5m  — T-15 lock (no provider calls)
 *   ?job=results   every 15m — results for matches that should have finished (only calls the provider when needed) → settle
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = new URL(req.url).searchParams.get("job");
  try {
    if (job === "lock") return NextResponse.json({ ok: true, locked: await lockDue(prisma) });
    const p = await getPrimaryProvider();
    if (!p) return NextResponse.json({ mode: "demo", message: "No usable provider key.", locked: await lockDue(prisma) });
    const provider = PROVIDER_ENUM[p.id] as Provider;
    if (job === "results") {
      const results = await syncResults(prisma, p, provider);
      const settled = await settle(prisma, provider);
      const days = settled.created || settled.corrected ? await snapshotAccuracy(prisma, provider) : 0;
      return NextResponse.json({ ok: true, results, settled, accuracyDays: days });
    }
    return NextResponse.json({ ok: true, report: await ingest(prisma, p) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
