/**
 * Why is a page empty?
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run diagnose
 *
 * Every page in this app is downstream of the one before it: a provider key → leagues → fixtures →
 * predictions → tips. An empty board is almost never a broken board; it is the first missing link, and
 * this walks the chain in order and names it, with the command that fixes it.
 *
 * It also asks the provider whether the key works, from THIS machine — a key can be valid and the
 * server still be unable to reach the API, and those two produce identical symptoms on the site.
 */
import { PrismaClient, type Provider } from "@prisma/client";
import { buildProvider, primaryProviderId, PROVIDER_ENUM } from "../src/lib/providers";
import { SECRET_NAMES, secretSource, type SecretName } from "../src/lib/secrets";
import { LEAGUE_ALLOWLIST } from "../src/lib/leagues";
import { dataMode } from "../src/lib/mode";

const db = new PrismaClient();
const fix: string[] = [];
const line = (label: string, value: string, hint?: string) => {
  console.log(`  ${label.padEnd(24)} ${value}`);
  if (hint) fix.push(hint);
};

/** The key each provider needs, so a mismatch can be named rather than guessed at. */
const KEY_FOR: Record<string, SecretName[]> = {
  "api-football": ["API_SPORTS_KEY", "RAPIDAPI_KEY"],
  "football-data": ["FOOTBALL_DATA_API_KEY"],
  sportmonks: ["SPORTMONKS_TOKEN"],
};

(async () => {
  console.log(`PitchEdge diagnose · ${new Date().toISOString()}\n`);

  try { await db.$queryRawUnsafe("SELECT 1"); } catch (e) {
    console.error(`database unreachable: ${(e as Error).message}\n\nCheck DATABASE_URL in .env, then: sudo systemctl restart pitchedge`);
    process.exit(1);
  }

  // ---- 1. which provider, and does its key exist -------------------------------------------------
  console.log("provider");
  const id = await primaryProviderId();
  line("selected", id);
  const wanted = KEY_FOR[id] ?? [];
  const present: string[] = [];
  for (const name of SECRET_NAMES) {
    const src = await secretSource(name).catch(() => "none" as const);
    if (src !== "none") present.push(`${name} (${src})`);
  }
  line("keys saved", present.length ? present.join(", ") : "none");
  const hasWanted = await Promise.all(wanted.map((k) => secretSource(k))).then((s) => s.some((x) => x !== "none"));
  if (!hasWanted) {
    /*
     * The mismatch worth naming explicitly: the provider defaults to api-football, so a football-data
     * key saved on its own leaves the app in demo mode with no explanation anywhere on the site.
     */
    line("key for this provider", `MISSING — ${id} needs ${wanted.join(" or ")}`,
      present.length
        ? `A key is saved but not the one "${id}" uses. Either save ${wanted.join(" or ")}, or switch the provider in Settings to match the key you have.`
        : `Settings → unlock → save ${wanted.join(" or ")}.`);
  } else line("key for this provider", "present");

  // ---- 2. can this machine actually reach it -----------------------------------------------------
  const provider = await buildProvider(id).catch(() => null);
  if (!provider) {
    line("connection", "not attempted (no usable key)");
  } else {
    const t = await provider.testConnection().catch((e) => ({ ok: false, message: (e as Error).message }));
    line("connection", `${t.ok ? "ok" : "FAILED"} — ${t.message}`,
      t.ok ? undefined : `The provider refused or could not be reached from this server: ${t.message}`);
  }

  // ---- 3. what the site is reading ---------------------------------------------------------------
  const mode = await dataMode();
  console.log("\nwhat the pages read");
  line("data mode", mode.demo ? "DEMO" : `live (${mode.provider})`);
  line("last sync", mode.lastSync ? mode.lastSync.toISOString() : "never");

  // ---- 4. leagues --------------------------------------------------------------------------------
  console.log("\nleagues");
  const byProvider = await db.league.groupBy({ by: ["provider"], _count: true });
  for (const row of byProvider) line(String(row.provider).toLowerCase(), `${row._count} league(s)`);
  if (!byProvider.length) line("none", "no leagues at all");
  const live = PROVIDER_ENUM[id] as Provider;
  const liveLeagues = await db.league.count({ where: { provider: live } });
  const synced = await db.league.count({ where: { provider: live, lastSyncAt: { not: null } } });
  const expected = (LEAGUE_ALLOWLIST[id] ?? []).length;
  line(`${id} matched`, `${liveLeagues} of ${expected} in the allowlist${expected && liveLeagues < expected ? " — the rest did not match a provider name" : ""}`,
    liveLeagues === 0 ? "npm run ingest        # discovers leagues and pulls fixtures; nothing exists before this runs" : undefined);
  line(`${id} synced`, `${synced}`);
  if (liveLeagues && liveLeagues < expected) fix.push("npm run leaguecheck   # names the competitions whose provider name did not match, which are skipped silently");

  // ---- 5. fixtures and predictions ---------------------------------------------------------------
  console.log("\nfixtures");
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  for (const p of [live, "DEMO" as Provider]) {
    const total = await db.fixture.count({ where: { provider: p } });
    const upcoming = await db.fixture.count({ where: { provider: p, status: "SCHEDULED", kickoffUtc: { gt: now, lt: soon } } });
    const withPred = await db.fixture.count({ where: { provider: p, status: "SCHEDULED", kickoffUtc: { gt: now, lt: soon }, predictions: { some: {} } } });
    line(String(p).toLowerCase(), `${total} total · ${upcoming} scheduled in 7 days · ${withPred} of those priced`);
    if (p === live && upcoming > 0 && withPred === 0) {
      fix.push("npm run ingest        # fixtures exist but none has a prediction, so every tip list is empty");
    }
  }

  // ---- 6. the conclusion -------------------------------------------------------------------------
  if (mode.demo && !(await db.fixture.count({ where: { provider: "DEMO" } }))) {
    fix.unshift("npm run selfcheck -- --demo   # in demo mode with no demo data, so the site has nothing at all to show");
  }
  console.log(fix.length
    ? `\nDo these, in order (from ${process.cwd()}):\n${[...new Set(fix)].map((f) => `  ${f}`).join("\n")}`
    : "\nNothing missing: a provider is connected, leagues are synced, and upcoming fixtures are priced.");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
