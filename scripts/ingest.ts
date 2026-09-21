import { PrismaClient } from "@prisma/client";
import { getPrimaryProvider } from "../src/lib/providers";
import { ingest } from "../src/lib/pipeline/ingest";

const db = new PrismaClient();
(async () => {
  const p = await getPrimaryProvider();
  if (!p) { console.log("No usable key for the primary provider — DEMO MODE. Run `npm run db:seed` instead."); return; }
  console.log(`Ingesting from ${p.id}…`);
  console.log(JSON.stringify(await ingest(db, p), null, 2));
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
