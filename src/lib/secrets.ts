import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

export const SECRET_NAMES = ["FOOTBALL_DATA_API_KEY", "API_SPORTS_KEY", "RAPIDAPI_KEY", "SPORTMONKS_TOKEN", "OPENAI_API_KEY"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

function key() {
  const k = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!k || k.length < 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be set (32+ chars) to save keys from Settings.");
  return createHash("sha256").update(k).digest();
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "enc:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decrypt(v: string): string {
  const b = Buffer.from(v.slice(4), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** Env wins (server source of truth); falls back to the encrypted settings row. */
export async function getSecret(name: SecretName): Promise<string | null> {
  const env = process.env[name];
  if (env) return env;
  const row = await prisma.appSetting.findUnique({ where: { key: `secret:${name}` } });
  if (!row) return null;
  try { return decrypt(row.value); } catch { return null; }
}
export async function secretSource(name: SecretName): Promise<"env" | "settings" | "none"> {
  if (process.env[name]) return "env";
  return (await prisma.appSetting.findUnique({ where: { key: `secret:${name}` } })) ? "settings" : "none";
}
export async function setSecret(name: SecretName, value: string) {
  const v = value.trim();
  if (!v) { await prisma.appSetting.deleteMany({ where: { key: `secret:${name}` } }); return; }
  await prisma.appSetting.upsert({ where: { key: `secret:${name}` }, update: { value: encrypt(v), secret: true }, create: { key: `secret:${name}`, value: encrypt(v), secret: true } });
}

export function checkPin(pin: string): boolean {
  const want = process.env.SETTINGS_PIN;
  if (!want) return false;
  const a = Buffer.from(pin), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getSetting<T>(k: string, fallback: T): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key: k } });
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}
export async function setSetting(k: string, v: unknown) {
  const value = JSON.stringify(v);
  await prisma.appSetting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } });
}
