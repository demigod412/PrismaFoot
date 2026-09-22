"use server";
import { cookies, headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSetting, setSetting } from "@/lib/secrets";
import { ACCESS_COOKIE, cookieOptions, issueToken } from "@/lib/access";

import { hashOf, makeHash, secretFor, type StoredCode as Stored } from "@/lib/accessSecret";

/** Wrong codes are throttled: after MAX_FAILS the form is locked for LOCK_MINUTES (kept on the server, so it can't be cleared from the phone). */
const MAX_FAILS = 5, LOCK_MINUTES = 5;
type Fails = { n: number; until: number };

export async function unlock(code: string): Promise<{ ok: boolean; message: string }> {
  const stored = await getSetting<Stored>("accessCode", null);
  if (!stored) return { ok: true, message: "No access code is set." };
  const fails = (await getSetting<Fails>("accessFails", { n: 0, until: 0 })) ?? { n: 0, until: 0 };
  if (fails.until > Date.now()) {
    const mins = Math.ceil((fails.until - Date.now()) / 60_000);
    return { ok: false, message: `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  const given = Buffer.from(hashOf(code.trim(), stored.salt), "hex"), want = Buffer.from(stored.hash, "hex");
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    const n = (fails.until ? 0 : fails.n) + 1;
    const locked = n >= MAX_FAILS;
    await setSetting("accessFails", { n: locked ? 0 : n, until: locked ? Date.now() + LOCK_MINUTES * 60_000 : 0 });
    return { ok: false, message: locked ? `Too many wrong codes. Try again in ${LOCK_MINUTES} minutes.` : `That code isn't right. ${MAX_FAILS - n} ${MAX_FAILS - n === 1 ? "try" : "tries"} left.` };
  }
  await setSetting("accessFails", { n: 0, until: 0 });
  const h = await headers();
  (await cookies()).set(ACCESS_COOKIE, await issueToken(secretFor(stored)), cookieOptions((h.get("x-forwarded-proto") ?? "https") === "https"));
  revalidatePath("/", "layout");
  return { ok: true, message: "Unlocked." };
}

export async function lockNow(): Promise<{ ok: boolean; message: string }> {
  (await cookies()).delete(ACCESS_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true, message: "Locked." };
}

/** Settings: set, change or remove the code (PIN-protected page). */
export async function saveAccessCode(code: string | null): Promise<{ ok: boolean; message: string }> {
  if (code === null || code.trim() === "") {
    await setSetting("accessCode", null); (await cookies()).delete(ACCESS_COOKIE); revalidatePath("/", "layout");
    return { ok: true, message: "Access code removed — anyone with the link can see the app." };
  }
  const c = code.trim();
  if (c.length < 4 || c.length > 32) return { ok: false, message: "Use 4 to 32 characters." };
  const stored = makeHash(c);
  await setSetting("accessCode", stored);
  (await cookies()).set(ACCESS_COOKIE, await issueToken(secretFor(stored)), cookieOptions(true));
  revalidatePath("/", "layout");
  return { ok: true, message: "Access code saved. Everyone else will be asked for it." };
}
