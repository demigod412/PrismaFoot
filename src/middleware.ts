import { NextResponse, type NextRequest } from "next/server";
/** Anonymous device id for slips (no accounts). HttpOnly, 1 year. */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get("pe_device")?.value) {
    res.cookies.set("pe_device", crypto.randomUUID(), { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 31536000 });
  }
  return res;
}
export const config = { matcher: ["/((?!_next|api|icons|sw.js|manifest.webmanifest|favicon).*)"] };
