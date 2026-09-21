import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPrimaryProvider } from "@/lib/providers";
import { ingest } from "@/lib/pipeline/ingest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron (every 3h) → ingest → rate → predict. Protected by CRON_SECRET. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = await getPrimaryProvider();
  if (!p) return NextResponse.json({ mode: "demo", message: "No usable provider key." });
  try { return NextResponse.json({ ok: true, report: await ingest(prisma, p, { historyDays: 120 }) }); }
  catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 }); }
}
