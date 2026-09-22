import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allMarkets, marketHit } from "@/lib/markets";
import type { Leg } from "@/lib/slips";
import { SlipWorkshop, type SlipView } from "@/components/SlipWorkshop";

export const metadata = { title: "Slips" };
export const dynamic = "force-dynamic";

export default async function Slips() {
  const jar = await cookies();
  const owner = jar.get("pe_device")?.value;
  const slips = owner ? await prisma.slip.findMany({ where: { ownerKey: owner }, orderBy: { updatedAt: "desc" } }) : [];
  const legsOf = (x: Prisma.JsonValue) => (Array.isArray(x) ? (x as unknown as Leg[]) : []);
  const ids = [...new Set(slips.flatMap((s) => legsOf(s.legs).map((l) => l.fixtureId)))];
  const fixtures = await prisma.fixture.findMany({
    where: { id: { in: ids } },
    include: { homeTeam: true, awayTeam: true, predictions: { orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }], take: 1 } },
  });
  const views: SlipView[] = slips.map((s) => ({
    id: s.id, name: s.name, bookingCode: s.bookingCode, bookingUrl: s.bookingUrl, bookingNote: s.bookingNote,
    legs: legsOf(s.legs).map((l) => {
      const f = fixtures.find((x) => x.id === l.fixtureId), p = f?.predictions[0];
      const live = p ? allMarkets(p, "Home", "Away").find((m) => m.key === l.market)?.p ?? l.p : l.p;
      const done = f?.status === "FINISHED" && f.homeGoals != null;
      const hit = done ? marketHit(l.market, { h: f!.homeGoals!, a: f!.awayGoals!, hc: f!.homeCorners, ac: f!.awayCorners, hs: f!.homeShots, as: f!.awayShots }, { corners: p?.cornersLine, shots: p?.shotsLine }) : null;
      return { ...l, p: live, band: p?.band ?? l.band, started: !!f && f.kickoffUtc <= new Date(), result: done ? `${f!.homeGoals}–${f!.awayGoals}` : null, hit };
    }),
  }));
  const active = jar.get("pe_slip")?.value;
  return <SlipWorkshop slips={views} activeId={views.some((v) => v.id === active) ? active! : views[0]?.id ?? null} />;
}
