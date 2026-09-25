"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createHmac } from "node:crypto";
import { checkPin, setSecret, setSetting, SECRET_NAMES, type SecretName } from "@/lib/secrets";
import { buildProvider, type LiveProviderId } from "@/lib/providers";
import { DEFAULT_FLOORS, type ScannerFloors } from "@/lib/scanners";
import { isTimeZone, TZ_COOKIE } from "@/lib/time";

const sig = () => createHmac("sha256", (process.env.SETTINGS_ENCRYPTION_KEY ?? "") + (process.env.SETTINGS_PIN ?? "")).update("pe-admin").digest("hex");
async function isAdmin() { return (await cookies()).get("pe_admin")?.value === sig() && !!process.env.SETTINGS_PIN; }

export type ActionState = { ok: boolean; message: string } | null;

export async function unlock(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!process.env.SETTINGS_PIN) return { ok: false, message: "Set SETTINGS_PIN in the server environment first." };
  if (!checkPin(String(fd.get("pin") ?? ""))) return { ok: false, message: "PIN not recognised." };
  (await cookies()).set("pe_admin", sig(), { httpOnly: true, secure: true, sameSite: "strict", path: "/settings", maxAge: 3600 });
  revalidatePath("/settings");
  return { ok: true, message: "Unlocked for one hour." };
}

export async function saveKeys(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Unlock with your PIN first." };
  try {
    for (const n of SECRET_NAMES) {
      const v = fd.get(n);
      if (typeof v === "string" && v.length) await setSecret(n as SecretName, v === "__clear__" ? "" : v);
    }
    const primary = String(fd.get("primary") ?? "");
    if (["football-data", "api-football", "sportmonks"].includes(primary)) await setSetting("primaryProvider", primary);
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved. Keys are encrypted server-side and never sent back to the browser." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function testConnection(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Unlock with your PIN first." };
  const id = String(fd.get("provider")) as LiveProviderId;
  const p = await buildProvider(id);
  if (!p) return { ok: false, message: `No key saved for ${id}.` };
  const r = await p.testConnection();
  return { ok: r.ok, message: `${id}: ${r.message}` };
}

export async function saveFloors(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Unlock with your PIN first." };
  const f: ScannerFloors = { ...DEFAULT_FLOORS };
  for (const k of Object.keys(DEFAULT_FLOORS) as (keyof ScannerFloors)[]) {
    const v = Number(fd.get(k));
    if (Number.isFinite(v) && v > 0 && v < 1) f[k] = v;
  }
  if (f.safeP < 0.6) return { ok: false, message: "Safe floor cannot go below 0.60." };
  await setSetting("scannerFloors", f);
  revalidatePath("/scanner", "layout");
  return { ok: true, message: "Scanner floors saved." };
}

export async function savePrefs(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Unlock with your PIN first." };
  await setSetting("defaultBookie", String(fd.get("bookie") ?? "sportybet"));
  return { ok: true, message: "Preferences saved." };
}

/**
 * Kickoff timezone. Deliberately NOT behind the settings PIN: it is a per-device display
 * preference held in that device's own cookie, so it changes nothing for anyone else and
 * there is nothing to protect. Falls back to DEFAULT_TIMEZONE when cleared.
 */
export async function saveTimezone(_: ActionState, fd: FormData): Promise<ActionState> {
  const zone = String(fd.get("zone") ?? "").trim();
  const jar = await cookies();
  if (zone === "__default__") {
    jar.delete(TZ_COOKIE);
    revalidatePath("/", "layout");
    return { ok: true, message: "Using the server default again." };
  }
  if (!isTimeZone(zone)) return { ok: false, message: "That is not a timezone this server recognises." };
  jar.set(TZ_COOKIE, zone, { httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31_536_000 });
  revalidatePath("/", "layout");
  return { ok: true, message: `Kickoff times now shown in ${zone.replace(/_/g, " ")}.` };
}

export { isAdmin };
