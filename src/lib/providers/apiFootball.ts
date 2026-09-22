import "server-only";
import { fetchJson, qs } from "./http";
import type { FootballProvider, FxStatus, PFixture, PInjury, PLeague, PStanding } from "./types";

/* API-Football v3 (direct api-sports or via RapidAPI). */
type AfFixture = {
  fixture: { id: number; date: string; status: { short: string }; venue?: { name?: string } };
  league: { id: number; season: number; round?: string };
  teams: { home: { id: number; name: string; logo?: string }; away: { id: number; name: string; logo?: string } };
  goals: { home: number | null; away: number | null };
};
type Resp<T> = { response: T; errors?: Record<string, string> | unknown[] };

const mapStatus = (s: string): FxStatus =>
  ["FT", "AET", "PEN", "AWD", "WO"].includes(s) ? "FINISHED"
  : ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(s) ? "LIVE"
  : ["PST", "SUSP"].includes(s) ? "POSTPONED"
  : ["CANC", "ABD"].includes(s) ? "CANCELLED" : "SCHEDULED";

export function apiFootball(opts: { key?: string; rapidKey?: string; rapidHost?: string; base?: string }): FootballProvider {
  const base = opts.base ?? process.env.API_SPORTS_BASE_URL ?? "https://v3.football.api-sports.io";
  const headers: Record<string, string> = opts.rapidKey
    ? { "x-rapidapi-key": opts.rapidKey, "x-rapidapi-host": opts.rapidHost ?? "v3.football.api-sports.io" }
    : { "x-apisports-key": opts.key ?? "" };
  const get = async <T>(path: string) => {
    const r = await fetchJson<Resp<T>>("api-football", `${base}${path}`, headers);
    const errs = r.errors && !Array.isArray(r.errors) ? Object.values(r.errors) : [];
    if (errs.length) throw new Error(`api-football: ${errs.join("; ")}`);
    return r.response;
  };
  const toFx = (f: AfFixture): PFixture => ({
    externalId: String(f.fixture.id), leagueExternalId: String(f.league.id), season: f.league.season,
    round: f.league.round, kickoffUtc: new Date(f.fixture.date), status: mapStatus(f.fixture.status.short),
    venue: f.fixture.venue?.name,
    home: { externalId: String(f.teams.home.id), name: f.teams.home.name, crestUrl: f.teams.home.logo },
    away: { externalId: String(f.teams.away.id), name: f.teams.away.name, crestUrl: f.teams.away.logo },
    homeGoals: f.goals.home, awayGoals: f.goals.away,
  });

  return {
    id: "api-football",
    async getLeagues() {
      const r = await get<{ league: { id: number; name: string; type: string }; country: { name: string }; seasons: { year: number; current: boolean }[] }[]>("/leagues?current=true");
      return r.map<PLeague>((l) => ({
        externalId: String(l.league.id), name: l.league.name, country: l.country.name,
        season: l.seasons.find((s) => s.current)?.year ?? new Date().getFullYear(),
      }));
    },
    async getFixtures({ from, to, leagueId, season }) {
      return (await get<AfFixture[]>(`/fixtures?${qs({ from, to, league: leagueId, season })}`)).map(toFx);
    },
    async getFixture(id) {
      const r = await get<AfFixture[]>(`/fixtures?id=${id}`);
      return r[0] ? toFx(r[0]) : null;
    },
    async getResults({ date }) {
      return (await get<AfFixture[]>(`/fixtures?date=${date}`)).map(toFx).filter((f) => f.status === "FINISHED");
    },
    async getStandings(leagueId, season) {
      const r = await get<{ league: { standings: { rank: number; team: { id: number; name: string; logo?: string }; points: number; form?: string; all: { played: number; goals: { for: number; against: number } } }[][] } }[]>(`/standings?${qs({ league: leagueId, season })}`);
      return (r[0]?.league.standings[0] ?? []).map<PStanding>((s) => ({
        team: { externalId: String(s.team.id), name: s.team.name, crestUrl: s.team.logo },
        position: s.rank, played: s.all.played, points: s.points,
        goalsFor: s.all.goals.for, goalsAgainst: s.all.goals.against, form: s.form,
      }));
    },
    async getH2H(homeId, awayId) {
      return (await get<AfFixture[]>(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=10`)).map(toFx);
    },
    async getLineups(fixtureId) {
      const r = await get<{ team: { id: number }; startXI: { player: { name: string } }[] }[]>(`/fixtures/lineups?fixture=${fixtureId}`);
      if (r.length < 2) return null;
      return { homeStarters: r[0].startXI.map((p) => p.player.name), awayStarters: r[1].startXI.map((p) => p.player.name), confirmed: true };
    },
    async getInjuries(fixtureId) {
      const r = await get<{ team: { id: number }; player: { name: string; type: string; reason: string } }[]>(`/injuries?fixture=${fixtureId}`);
      // "Missing Fixture" = confirmed out; "Questionable" is NOT counted as an absence.
      return r.map<PInjury>((x) => ({ teamExternalId: String(x.team.id), player: x.player.name, reason: x.player.reason, confirmedOut: x.player.type === "Missing Fixture" }));
    },
    async getXg() { return null; }, // API-Football exposes expected_goals only via /fixtures/statistics on some plans; add in Phase 6.
    async getOdds(fixtureId) {
      const r = await get<{ bookmakers: { name: string; bets: { name: string; values: { value: string; odd: string }[] }[] }[] }[]>(`/odds?fixture=${fixtureId}`);
      return (r[0]?.bookmakers ?? []).flatMap((b) => {
        const mw = b.bets.find((x) => x.name === "Match Winner");
        if (!mw) return [];
        const v = (k: string) => Number(mw.values.find((x) => x.value === k)?.odd);
        return [{ bookmaker: b.name, home: v("Home"), draw: v("Draw"), away: v("Away") }];
      });
    },
    async testConnection() {
      try {
        const r = await fetchJson<{ response: { requests?: { current: number; limit_day: number } } }>("api-football", `${base}/status`, headers);
        const q = r.response?.requests;
        return { ok: true, message: q ? `Connected. ${q.current}/${q.limit_day} requests used today` : "Connected" };
      } catch (e) { return { ok: false, message: (e as Error).message }; }
    },
  };
}
