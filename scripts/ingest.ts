/**
 * Full sync, run as its OWN process (not inside the web server), so the site stays fast while ratings are fitted.
 * Cron / manual:  cd /var/www/pitchedge && npm run ingest
 */
import { PrismaClient } from "@prisma/client";
import { getPrimaryProvider } from "../src/lib/providers";
import { ingest } from "../src/lib/pipeline/ingest";
import { lockDue } from "../src/lib/pipeline/ledger";

const db = new PrismaClient();
(async () => {
  const started = new Date();
  const p = await getPrimaryProvider();
  if (!p) { console.log(JSON.stringify({ at: started.toISOString(), mode: "demo", message: "No usable provider key.", locked: await lockDue(db) })); return; }
  const report = await ingest(db, p);
  console.log(JSON.stringify({ at: started.toISOString(), ok: true, seconds: Math.round((Date.now() - started.getTime()) / 1000), report }));
})().catch((e) => { console.log(JSON.stringify({ at: new Date().toISOString(), ok: false, error: (e as Error).message })); process.exitCode = 1; }).finally(() => db.$disconnect());
