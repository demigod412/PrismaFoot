import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDLE_MINUTES } from "@/lib/access";

/** Anonymous device id for slips (no accounts), the path for the access gate, and the sliding unlock window. */
export function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: { headers: new Headers([...req.headers, ["x-pathname", req.nextUrl.pathname]]) } });
  res.headers.set("x-pathname", req.nextUrl.pathname);
  // Re-set the unlock cookie on every page view so the 30-minute window measures inactivity, not session length.
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (token) res.cookies.set(ACCESS_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: IDLE_MINUTES * 60 });
  if (!req.cookies.get("pe_device")?.value) {
    res.cookies.set("pe_device", crypto.randomUUID(), { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 31536000 });
  }
  return res;
}
export const config = { matcher: ["/((?!_next|api|icons|sw.js|manifest.webmanifest|favicon).*)"] };
