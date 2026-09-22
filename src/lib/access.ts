/*
 * Access code: a shared code that unlocks the app on a device.
 *   · the code is stored hashed (scrypt) in AppSetting, never in plain text
 *   · unlocking sets a signed cookie carrying an expiry; every page view extends it (sliding 30-minute window)
 *   · Settings is always reachable, so the code can be changed or switched off with the Settings PIN
 * Signing uses HMAC-SHA256 via Web Crypto, so the same helpers work in middleware (edge) and on the server.
 */
export const ACCESS_COOKIE = "pe_access";
export const IDLE_MINUTES = Number(process.env.ACCESS_IDLE_MINUTES ?? 30);
const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as Uint8Array).toString("base64url");

async function keyOf(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function sign(payload: string, secret: string) {
  return b64url(await crypto.subtle.sign("HMAC", await keyOf(secret), enc.encode(payload)));
}
/** Token = base64url({exp}) + "." + HMAC. */
export async function issueToken(secret: string, minutes = IDLE_MINUTES) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + minutes * 60_000 })));
  return `${payload}.${await sign(payload, secret)}`;
}
export async function readToken(token: string | undefined, secret: string): Promise<{ valid: boolean; exp: number }> {
  if (!token || !secret) return { valid: false, exp: 0 };
  const [payload, sig] = token.split(".");
  if (!payload || !sig || (await sign(payload, secret)) !== sig) return { valid: false, exp: 0 };
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp: number };
    return { valid: exp > Date.now(), exp };
  } catch { return { valid: false, exp: 0 }; }
}
export const cookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: IDLE_MINUTES * 60 });
/** Paths that stay reachable while locked. */
export const isOpenPath = (path: string) =>
  path.startsWith("/settings") || path.startsWith("/api") || path.startsWith("/_next") || path.startsWith("/icons") ||
  path === "/manifest.webmanifest" || path === "/sw.js" || path === "/~offline" || path.startsWith("/favicon");
