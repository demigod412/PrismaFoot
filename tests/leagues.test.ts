import { describe, expect, it } from "vitest";
import { entryFor, LEAGUE_ALLOWLIST, MORE_API_FOOTBALL } from "@/lib/leagues";

const allow = LEAGUE_ALLOWLIST["api-football"];
const match = (country: string, name: string) => entryFor(allow, { externalId: "x", name, country });

/*
 * Every name here was copied from a live API-Football plan's competition list (`npm run leaguecheck`).
 * League matching is by country + name and a mismatch is skipped in silence, so these are the only
 * thing standing between a typo and a league that quietly never syncs.
 */
describe("API-Football league allowlist", () => {
  it("is actually wired into the allowlist", () => {
    // It was defined in 0.7.1, extended in 0.9.0 and never referenced, so none of it synced.
    expect(MORE_API_FOOTBALL.length).toBeGreaterThan(150);
    for (const e of MORE_API_FOOTBALL) expect(allow).toContain(e);
  });

  it("matches the names the provider really returns", () => {
    const real: [string, string][] = [
      // corrected in 0.9.6 after seeing the provider's own list
      ["Serbia", "Prva Liga"], ["Peru", "Primera División"], ["Peru", "Segunda División"],
      ["Paraguay", "Division Profesional - Apertura"], ["Paraguay", "Division Intermedia"],
      ["Panama", "Liga Panameña de Fútbol"], ["Azerbaijan", "Premyer Liqa"], ["Iraq", "Iraqi League"],
      ["Jordan", "League"], ["Egypt", "Second League"], ["South-Africa", "1st Division"],
      ["Kenya", "FKF Premier League"], ["France", "Ligue 3"], ["Sweden", "Ettan - Norra"],
      ["Norway", "2. Division - Group 1"], ["Estonia", "Esiliiga A"], ["Finland", "Kakkonen - Lohko A"],
      ["Poland", "II Liga - East"], ["Italy", "Serie C - Girone A"], ["Czech-Republic", "3. liga - CFL A"],
      ["Bosnia", "Premijer Liga"], ["Bosnia", "1st League - FBiH"],
      ["Macedonia", "First League"], ["Georgia", "Erovnuli Liga 2"], ["Bolivia", "Nacional B"],
      ["Wales", "FAW Championship"], ["Kosovo", "Superliga"], ["Faroe-Islands", "Meistaradeildin"],
      // accents: the provider writes "Úrvalsdeild", the entry writes "Urvalsdeild"
      ["Iceland", "Úrvalsdeild"],
      // already correct, kept as regression cover
      ["Finland", "Veikkausliiga"], ["Czech-Republic", "Czech Liga"], ["Czech-Republic", "FNL"],
      ["Romania", "Liga I"], ["Romania", "Liga II"], ["Ukraine", "Persha Liga"],
      ["Israel", "Liga Leumit"], ["Uruguay", "Segunda División"], ["Ecuador", "Liga Pro Serie B"],
      ["Japan", "J2 League"], ["South-Korea", "K League 2"], ["Morocco", "Botola 2"],
      ["Argentina", "Primera Nacional"], ["Brazil", "Serie C"], ["USA", "USL Championship"],
    ];
    const missed = real.filter(([c, n]) => !match(c, n)).map(([c, n]) => `${c} / ${n}`);
    expect(missed, `these would silently never sync:\n${missed.join("\n")}`).toEqual([]);
  });

  it("never syncs women's, youth, reserve or play-off competitions", () => {
    const skip: [string, string][] = [
      ["Spain", "Primera División Femenina"], ["Romania", "Liga 1 Feminin"], ["Mexico", "Liga MX Femenil"],
      ["Germany", "Frauen Bundesliga"], ["England", "FA WSL"], ["Netherlands", "Eredivisie Women"],
      ["Brazil", "Brasileiro U20 A"], ["Turkey", "U19 league"], ["Italy", "Campionato Primavera - 1"],
      ["Belgium", "Reserve Pro League"], ["Italy", "Serie C - Promotion - Play-offs"],
      ["Spain", "Primera División RFEF - Play Offs"], ["Finland", "Kakkonen - Play-offs"],
      ["Netherlands", "Derde Divisie - Relegation Round"],
    ];
    const leaked = skip.filter(([c, n]) => match(c, n)).map(([c, n]) => `${c} / ${n}`);
    expect(leaked, `these would be synced by mistake:\n${leaked.join("\n")}`).toEqual([]);
  });

  it("covers every top flight it lists a lower tier for", () => {
    // K League 1 was dropped in the 0.9.6 rewrite while K League 2 and K3 stayed, so Korea
    // synced its second and third tiers and not its first.
    expect(match("South-Korea", "K League 1")).toBeTruthy();
    expect(match("South-Korea", "K League 2")?.tier).toBe(2);
    const tiered = MORE_API_FOOTBALL.filter((e) => e.match && (e.tier ?? 1) > 1);
    const topFlights = new Set(MORE_API_FOOTBALL.filter((e) => e.match && (e.tier ?? 1) === 1).map((e) => e.match!.country));
    // Every country with a lower tier here needs its top flight either here or under an explicit id.
    const byId = new Set(["England", "Spain", "Italy", "Germany", "France", "Netherlands", "Portugal",
      "Scotland", "Belgium", "Turkey", "Greece", "Austria", "Switzerland", "Denmark", "Norway", "Sweden",
      "Brazil", "Argentina", "Mexico", "USA", "Saudi-Arabia", "Japan", "Egypt", "South-Africa", "Nigeria"]);
    const orphans = [...new Set(tiered.map((e) => e.match!.country))].filter((c) => !topFlights.has(c) && !byId.has(c));
    expect(orphans, `lower tiers with no top flight: ${orphans.join(", ")}`).toEqual([]);
  });

  it("refuses cups, super cups and one-off finals", () => {
    // "Serie C - Supercoppa Lega Finals" slipped through the /^Serie C/ prefix.
    for (const [c, n] of [["Italy", "Serie C - Supercoppa Lega Finals"], ["Paraguay", "Copa Paraguay"],
      ["Poland", "Super Cup"], ["Romania", "Cupa României"], ["Hungary", "Magyar Kupa"],
      ["Germany", "DFB Pokal"], ["England", "FA Trophy"]] as [string, string][]) {
      expect(match(c, n), `${c} / ${n} should not sync`).toBeUndefined();
    }
    // ...but the curated international cups come in by id and must still work.
    expect(entryFor(allow, { externalId: "1", name: "World Cup", country: "World" })).toBeTruthy();
    expect(entryFor(allow, { externalId: "13", name: "CONMEBOL Libertadores", country: "World" })).toBeTruthy();
  });

  it("numbers the English pyramid correctly", () => {
    // tier drives the prior a promoted or relegated club carries; League One and League Two
    // were both marked tier 2.
    const tier = (id: string) => allow.find((a) => a.id === id)?.tier;
    expect(tier("40")).toBe(2); // Championship
    expect(tier("41")).toBe(3); // League One
    expect(tier("42")).toBe(4); // League Two
  });

  it("still honours an explicit id even when the name looks excluded", () => {
    // Ids are curated by hand, so they bypass the name guard entirely.
    expect(entryFor(allow, { externalId: "39", name: "anything at all", country: "England" })).toBeTruthy();
  });

  it("does not confuse same-named leagues in different countries", () => {
    expect(match("Russia", "First League")?.tier).toBe(2);
    expect(match("Macedonia", "First League")?.tier).toBeUndefined(); // top flight
    expect(match("Montenegro", "Second League")?.tier).toBe(2);
    expect(match("Nowhere", "First League")).toBeUndefined();
  });
});

describe("european rating pool size", () => {
  // buildContext loads every finished fixture from the last 450 days across every league that feeds
  // the pool, with both teams included, once per European cup. Letting lower tiers in took it from
  // ~20 competitions to ~150 and got the sync killed for running out of memory.
  it("is fed by top flights only", () => {
    const feeders = MORE_API_FOOTBALL.filter((e) => e.feeds === "europe");
    const lower = feeders.filter((e) => (e.tier ?? 1) !== 1).map((e) => `${e.match?.country} ${String(e.match?.name)}`);
    expect(lower, `lower tiers must not feed the europe pool:\n${lower.join("\n")}`).toEqual([]);
  });
  it("stays small enough to fit in memory", () => {
    const feeders = MORE_API_FOOTBALL.filter((e) => e.feeds === "europe");
    expect(feeders.length).toBeGreaterThan(20);  // it is doing its job
    expect(feeders.length).toBeLessThan(60);     // and not ruining the server
  });
  it("still rates lower tiers, just on their own league", () => {
    const czech2 = MORE_API_FOOTBALL.find((e) => e.match?.country === "Czech-Republic" && e.tier === 2);
    expect(czech2).toBeTruthy();
    expect(czech2!.feeds).toBeUndefined();
  });
});

describe("who gets the capped stats/odds/injury budget", () => {
  // Those three calls are capped PER SYNC, not per league, so whichever leagues run first spend the
  // lot. One real run gave 30 of 30 stats calls to Kenya's second tier before reaching anything else.
  const isMajor = (country: string, name: string, externalId = "x") => {
    const e = entryFor(allow, { externalId, name, country });
    if (!e || e.pool) return false;
    return e.focus === "europe-strong" || e.focus === "england" || (e.tier ?? 1) === 1;
  };

  it("includes top flights matched by name", () => {
    for (const [c, n] of [["Finland", "Veikkausliiga"], ["Czech-Republic", "Czech Liga"],
      ["Romania", "Liga I"], ["Serbia", "Super Liga"], ["Uruguay", "Primera Divisi\u00f3n"],
      ["Peru", "Primera Divisi\u00f3n"], ["Iraq", "Iraqi League"]] as [string, string][]) {
      expect(isMajor(c, n), `${c} / ${n} should get the budget`).toBe(true);
    }
  });

  it("includes the top flights carried by an explicit id", () => {
    // These arrive with their provider id and match on that, not on their name.
    for (const [id, c, n] of [["39", "England", "Premier League"], ["140", "Spain", "La Liga"],
      ["88", "Netherlands", "Eredivisie"], ["94", "Portugal", "Primeira Liga"],
      ["203", "Turkey", "S\u00fcper Lig"], ["71", "Brazil", "Serie A"]] as [string, string, string][]) {
      expect(isMajor(c, n, id), `${c} / ${n} (id ${id}) should get the budget`).toBe(true);
    }
  });

  it("excludes lower tiers, where corners, shots and value are not worth the quota", () => {
    for (const [c, n] of [["Kenya", "Super League"], ["Finland", "Kakkonen - Lohko A"],
      ["Kuwait", "Division 1"], ["Italy", "Serie C - Girone A"], ["Czech-Republic", "3. liga - CFL A"],
      ["Norway", "2. Division - Group 1"], ["Sweden", "Ettan - Norra"],
      ["Argentina", "Primera B Metropolitana"]] as [string, string][]) {
      expect(isMajor(c, n), `${c} / ${n} should not spend the budget`).toBe(false);
    }
  });

  it("excludes the pooled cups, which are rated from the domestic leagues anyway", () => {
    expect(isMajor("World", "UEFA Champions League", "2")).toBe(false);
    expect(isMajor("World", "World Cup", "1")).toBe(false);
  });
});
