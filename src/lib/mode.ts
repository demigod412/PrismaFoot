import "server-only";
import { cache } from "react";
import type { Provider } from "@prisma/client";
import { getPrimaryProvider, PROVIDER_ENUM } from "./providers";
import { prisma } from "./db";

/** Which data set pages read. Demo when no usable key OR the live provider has not synced yet. */
export const dataMode = cache(async (): Promise<{ demo: boolean; provider: Provider; lastSync: Date | null }> => {
  const p = await getPrimaryProvider();
  if (p) {
    const provider = PROVIDER_ENUM[p.id] as Provider;
    const l = await prisma.league.findFirst({ where: { provider }, orderBy: { lastSyncAt: "desc" } });
    if (l) return { demo: false, provider, lastSync: l.lastSyncAt };
  }
  const d = await prisma.league.findFirst({ where: { provider: "DEMO" }, orderBy: { lastSyncAt: "desc" } });
  return { demo: true, provider: "DEMO", lastSync: d?.lastSyncAt ?? null };
});
