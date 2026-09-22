"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allMarkets, type MarketKey } from "@/lib/markets";
import { addLeg, dropLowConfidence, dropWeakest, mergeSlips, removeLeg, splitInTwo, trimToTarget, type Leg } from "@/lib/slips";
import { sportybetBook } from "@/lib/booking/sportybet";

export type SlipResult = { ok: boolean; message: string };
const legsOf = (x: Prisma.JsonValue) => (Array.isArray(x) ? (x as unknown as Leg[]) : []);
const asJson = (legs: Leg[]) => legs as unknown as Prisma.InputJsonValue;

async function device(): Promise<string> {
  const jar = await cookies();
  let d = jar.get("pe_device")?.value;
  if (!d) { d = crypto.randomUUID(); jar.set("pe_device", d, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 }); }
  return d;
}
async function ownSlip(id: string) {
  const s = await prisma.slip.findUnique({ where: { id } });
  if (!s || s.ownerKey !== (await device())) throw new Error("Slip not found.");
  return s;
}
async function activeSlip(create = true) {
  const owner = await device(), jar = await cookies();
  const id = jar.get("pe_slip")?.value;
  const cur = id ? await prisma.slip.findFirst({ where: { id, ownerKey: owner } }) : null;
  if (cur || !create) return cur;
  const n = await prisma.slip.count({ where: { ownerKey: owner } });
  const s = await prisma.slip.create({ data: { ownerKey: owner, name: `Slip ${n + 1}`, legs: [] } });
  jar.set("pe_slip", s.id, { sameSite: "lax", path: "/", maxAge: 31536000 });
  return s;
}
const done = (message: string, ok = true): SlipResult => { revalidatePath("/slips"); return { ok, message }; };

/** Add a market from a match to the active slip (one leg per match; a new market replaces the old one). */
export async function addToSlip(fixtureId: string, market: MarketKey): Promise<SlipResult> {
  try {
    const fx = await prisma.fixture.findUnique({ where: { id: fixtureId }, include: { homeTeam: true, awayTeam: true, predictions: { orderBy: { revision: "desc" }, take: 1 } } });
    const p = fx?.predictions[0];
    if (!fx || !p) return { ok: false, message: "No prediction for this match yet." };
    if (fx.status !== "SCHEDULED" || fx.kickoffUtc <= new Date()) return { ok: false, message: "This match has already started." };
    const H = fx.homeTeam.shortName ?? fx.homeTeam.name, A = fx.awayTeam.shortName ?? fx.awayTeam.name;
    const m = allMarkets(p, H, A).find((x) => x.key === market);
    if (!m) return { ok: false, message: "That market isn't available for this match." };
    const slip = (await activeSlip())!;
    const r = addLeg(legsOf(slip.legs), { fixtureId, market, label: m.label, match: `${H} v ${A}`, kickoff: fx.kickoffUtc.toISOString(), p: m.p, band: p.band, addedAt: new Date().toISOString() });
    if (r.full) return { ok: false, message: "Slip is full (30 legs)." };
    await prisma.slip.update({ where: { id: slip.id }, data: { legs: asJson(r.legs), bookingCode: null, bookingUrl: null, bookingNote: null } });
    return done(r.replaced ? `Replaced the pick for ${H} v ${A} in ${slip.name}` : `Added to ${slip.name}`);
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function newSlip(): Promise<SlipResult> {
  const owner = await device(), n = await prisma.slip.count({ where: { ownerKey: owner } });
  const s = await prisma.slip.create({ data: { ownerKey: owner, name: `Slip ${n + 1}`, legs: [] } });
  (await cookies()).set("pe_slip", s.id, { sameSite: "lax", path: "/", maxAge: 31536000 });
  return done(`Created ${s.name}`);
}
export async function selectSlip(id: string): Promise<SlipResult> {
  const s = await ownSlip(id); (await cookies()).set("pe_slip", s.id, { sameSite: "lax", path: "/", maxAge: 31536000 });
  return done(`${s.name} is now active`);
}
export async function renameSlip(id: string, name: string): Promise<SlipResult> {
  await ownSlip(id); await prisma.slip.update({ where: { id }, data: { name: name.trim().slice(0, 40) || "Slip" } }); return done("Renamed");
}
export async function deleteSlip(id: string): Promise<SlipResult> {
  await ownSlip(id); await prisma.slip.delete({ where: { id } }); return done("Slip deleted");
}
export async function removeFromSlip(id: string, fixtureId: string): Promise<SlipResult> {
  const s = await ownSlip(id);
  await prisma.slip.update({ where: { id }, data: { legs: asJson(removeLeg(legsOf(s.legs), fixtureId)), bookingCode: null, bookingUrl: null } });
  return done("Leg removed");
}
export async function optimiseSlip(id: string, mode: "weakest" | "low" | "target", target = 0.25): Promise<SlipResult> {
  const s = await ownSlip(id), legs = legsOf(s.legs);
  const r = mode === "weakest" ? (() => { const x = dropWeakest(legs); return { legs: x.legs, dropped: x.dropped ? [x.dropped] : [] }; })()
    : mode === "low" ? dropLowConfidence(legs) : trimToTarget(legs, target);
  await prisma.slip.update({ where: { id }, data: { legs: asJson(r.legs), bookingCode: null, bookingUrl: null } });
  return done(r.dropped.length ? `Dropped ${r.dropped.length}: ${r.dropped.map((l) => l.match).join(", ")}` : "Nothing to drop");
}
export async function splitSlip(id: string): Promise<SlipResult> {
  const s = await ownSlip(id), legs = legsOf(s.legs);
  if (legs.length < 2) return { ok: false, message: "Need at least 2 legs to split." };
  const [a, b] = splitInTwo(legs);
  await prisma.slip.update({ where: { id }, data: { legs: asJson(a), name: `${s.name} (A)`, bookingCode: null, bookingUrl: null } });
  await prisma.slip.create({ data: { ownerKey: s.ownerKey, name: `${s.name} (B)`, legs: asJson(b) } });
  return done("Split into two slips of similar strength");
}
export async function mergeInto(targetId: string, sourceId: string): Promise<SlipResult> {
  if (targetId === sourceId) return { ok: false, message: "Pick a different slip to merge." };
  const t = await ownSlip(targetId), s = await ownSlip(sourceId);
  const r = mergeSlips(legsOf(t.legs), legsOf(s.legs));
  await prisma.slip.update({ where: { id: t.id }, data: { legs: asJson(r.legs), bookingCode: null, bookingUrl: null } });
  await prisma.slip.delete({ where: { id: s.id } });
  return done(r.duplicates.length ? `Merged. Same match in both slips (kept the stronger pick): ${r.duplicates.join(", ")}` : `Merged ${s.name} into ${t.name}`);
}

/** Resolve fixtures and ask Sportybet for a code. Shared by slips and the Blend builder. */
async function bookLegs(legs: { fixtureId: string; market: MarketKey; label: string }[]) {
  const fx = await prisma.fixture.findMany({ where: { id: { in: legs.map((l) => l.fixtureId) } }, include: { homeTeam: true, awayTeam: true } });
  const r = await sportybetBook(legs.flatMap((l) => { const f = fx.find((x) => x.id === l.fixtureId); return f && f.kickoffUtc > new Date() ? [{ fixtureId: l.fixtureId, market: l.market, home: f.homeTeam.name, away: f.awayTeam.name, kickoff: f.kickoffUtc, label: l.label }] : []; }));
  const note = r.unbookable.length ? `Not booked: ${r.unbookable.map((u) => `${u.label} (${u.reason})`).join("; ")}` : null;
  return { ...r, note };
}

export type BookResult = { ok: boolean; message: string; code: string | null; url: string | null; note: string | null };
/** Blend builder: book the selected legs directly (nothing is saved). */
export async function bookBlend(legs: { fixtureId: string; market: MarketKey; label: string }[]): Promise<BookResult> {
  if (process.env.SPORTYBET_ENABLED === "false") return { ok: false, message: "Sportybet export is switched off on this server.", code: null, url: null, note: null };
  if (!legs.length) return { ok: false, message: "Pick at least one leg.", code: null, url: null, note: null };
  try {
    const r = await bookLegs(legs.slice(0, 30));
    return r.code ? { ok: true, message: r.note ? "Code created — some legs could not be booked." : "Code created.", code: r.code, url: r.url, note: r.note }
      : { ok: false, message: r.note ?? "No legs could be booked.", code: null, url: null, note: r.note };
  } catch (e) {
    return { ok: false, message: `Sportybet export failed: ${(e as Error).message}. Sportybet may block servers outside Nigeria; the text can still be copied.`, code: null, url: null, note: null };
  }
}

/** Best-effort Sportybet booking code. Unmapped legs are listed, never silently dropped. */
export async function bookSportybet(id: string): Promise<SlipResult> {
  if (process.env.SPORTYBET_ENABLED === "false") return { ok: false, message: "Sportybet export is switched off on this server." };
  const s = await ownSlip(id), legs = legsOf(s.legs).filter((l) => new Date(l.kickoff) > new Date());
  if (!legs.length) return { ok: false, message: "No upcoming legs to book." };
  try {
    const r = await bookLegs(legs);
    const note = r.note;
    await prisma.slip.update({ where: { id }, data: { bookingCode: r.code, bookingUrl: r.url, bookingAt: new Date(), bookingNote: note, bookie: "sportybet" } });
    return done(r.code ? `Sportybet code ${r.code}${note ? " (some legs could not be booked)" : ""}` : note ?? "No legs could be booked.", !!r.code);
  } catch (e) {
    const msg = `Sportybet export failed: ${(e as Error).message}. Sportybet may block servers outside Nigeria; the slip text can still be copied.`;
    await prisma.slip.update({ where: { id }, data: { bookingNote: msg, bookingAt: new Date() } });
    return done(msg, false);
  }
}
