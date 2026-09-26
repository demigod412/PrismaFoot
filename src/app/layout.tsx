import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { BottomTabs, LeftRail } from "@/components/Nav";
import { Disclaimer } from "@/components/Disclaimer";
import { DemoBanner } from "@/components/DemoBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { RouteProgress } from "@/components/RouteProgress";
import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { dataMode } from "@/lib/mode";
import { getSetting } from "@/lib/secrets";
import { ACCESS_COOKIE, IDLE_MINUTES, isOpenPath, readToken } from "@/lib/access";
import { secretFor } from "@/lib/accessSecret";
import { UnlockScreen } from "@/components/UnlockScreen";
import { getLeagues } from "@/lib/queries";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "PitchEdge — calibrated football probabilities", template: "%s · PitchEdge" },
  description: "Model probabilities for football fixtures with a public, append-only accuracy ledger. Same output for every user. Not a bookmaker.",
  applicationName: "PitchEdge",
  appleWebApp: { capable: true, title: "PitchEdge", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: "#0B1220", width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Access gate: everything except Settings needs the code, if one is set.
  let locked = false;
  try {
    const stored = await getSetting<{ salt: string; hash: string } | null>("accessCode", null);
    if (stored) {
      const path = (await headers()).get("x-pathname") ?? "/";
      const t = await readToken((await cookies()).get(ACCESS_COOKIE)?.value, secretFor(stored));
      locked = !t.valid && !isOpenPath(path);
    }
  } catch { /* DB down: leave the app open rather than locking everyone out */ }
  let mode: Awaited<ReturnType<typeof dataMode>> = { demo: true, provider: "DEMO", lastSync: null };
  let leagues: { id: string; name: string; country: string }[] = [];
  try { mode = await dataMode(); leagues = await getLeagues(); } catch { /* DB down: pages render their own error states */ }
  return (
    <html lang="en" className={`${GeistSans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        {/* Suspense because RouteProgress reads the query string. */}
        <Suspense fallback={null}><RouteProgress /></Suspense>
        {locked ? <UnlockScreen minutes={IDLE_MINUTES} /> : <>
        <DemoBanner demo={mode.demo} lastSync={mode.lastSync} />
        <div className="flex">
          <LeftRail leagues={leagues} />
          <div className="min-w-0 flex-1">
            <main className="mx-auto max-w-5xl px-4 pt-5 md:px-8 md:pt-8">{children}</main>
            <Disclaimer />
          </div>
        </div>
        <BottomTabs />
        <InstallPrompt />
        </>}
      </body>
    </html>
  );
}
