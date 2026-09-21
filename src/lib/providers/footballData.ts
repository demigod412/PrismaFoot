import "server-only";
import { fetchJson } from "./http";
import type { FootballProvider, FxStatus, PFixture, PLeague, PStanding } from "./types";

/* football-data.org v4. Free tier: 10 req/min, top competitions, no lineups/injuries/xG. */
type FdTeam = { id: number; name: string; shortName?: string; crest?: string };
type FdMatch = {
  id: number; utcDate: string; status: string; matchday?: number; venue?: string;
  season: { startDate: string }; competition: { id: number; code: string };
  homeTeam: FdTeam; awayTeam: FdTeam;
  score: { fullTime: { home: number | null; away: number | null } };
};

const mapStatus = (s: string): FxStatus =>
  s === "FINISHED" || s === "AWARDED" ? "FINISHED"
  : s === "IN_PLAY" || s === "PAUSED" || s === "LIVE" ? "LIVE"
  : s === "POSTPONED" || s === "SUSPENDED" ? "POSTPONED"
  : s === "CANCELLED" ? "CANCELLED" : "SCHEDULED";

export function footballData(key: string, base = process.env.FOOTBALL_DATA_BASE_URL ?? "https://api.football-data.org/v4"): FootballProvider {
  const get = <T>(path: string) => fetchJson<T>("football-data", `${base}${path}`, { "X-Auth-Token": key });
  const toFx = (m: FdMatch): PFixture => ({
    externalId: String(m.id), leagueExternalId: m.competition.code ?? String(m.competition.id),
    season: Number(m.season.startDate.slice(0, 4)), round: m.matchday ? `Matchday ${m.matchday}` : undefined,
    kickoffUtc: new Date(m.utcDate), status: mapStatus(m.status), venue: m.venue,
    home: { externalId: String(m.homeTeam.id), name: m.homeTeam.name, shortName: m.homeTeam.shortName, crestUrl: m.homeTeam.crest },
    away: { externalId: String(m.awayTeam.id), name: m.awayTeam.name, shortName: m.awayTeam.shortName, crestUrl: m.awayTeam.crest },
    homeGoals: m.score.fullTime.home, awayGoals: m.score.fullTime.away,
  });

  return {
    id: "football-data",
    async getLeagues() {
      const r = await get<{ competitions: { id: number; code: string; name: string; area: { name: string }; currentSeason?: { startDate: string } }[] }>("/competitions");
      return r.competitions.filter((c) => c.currentSeason).map<PLeague>((c) => ({
        externalId: c.code ?? String(c.id), name: c.name, country: c.area.name, code: c.code,
        season: Number(c.currentSeason!.startDate.slice(0, 4)),
      }));
    },
    async getFixtures({ from, to, leagueId }) {
      const r = await get<{ matches: FdMatch[] }>(`/competitions/${leagueId}/matches?dateFrom=${from}&dateTo=${to}`);
      return r.matches.map(toFx);
    },
    async getFixture(id) {
      const m = await get<FdMatch>(`/matches/${id}`);
      return m ? toFx(m) : null;
    },
    async getResults({ date }) {
      const r = await get<{ matches: FdMatch[] }>(`/matches?dateFrom=${date}&dateTo=${date}&status=FINISHED`);
      return r.matches.map(toFx);
    },
    async getStandings(leagueId) {
      const r = await get<{ standings: { type: string; table: { position: number; team: FdTeam; playedGames: number; points: number; goalsFor: number; goalsAgainst: number; form?: string }[] }[] }>(`/competitions/${leagueId}/standings`);
      const total = r.standings.find((s) => s.type === "TOTAL") ?? r.standings[0];
      return (total?.table ?? []).map<PStanding>((t) => ({
        team: { externalId: String(t.team.id), name: t.team.name, shortName: t.team.shortName, crestUrl: t.team.crest },
        position: t.position, played: t.playedGames, points: t.points, goalsFor: t.goalsFor, goalsAgainst: t.goalsAgainst,
        form: t.form?.replace(/,/g, ""),
      }));
    },
    async getH2H(homeId, awayId) {
      // No direct pair endpoint on v4 free: pull the home team's finished matches and filter.
      const r = await get<{ matches: FdMatch[] }>(`/teams/${homeId}/matches?status=FINISHED&limit=100`);
      return r.matches.filter((m) => String(m.homeTeam.id) === awayId || String(m.awayTeam.id) === awayId).map(toFx);
    },
    async getLineups() { return null; },
    async getInjuries() { return null; },
    async getXg() { return null; },
    async getOdds() { return []; },
    async testConnection() {
      try { const l = await this.getLeagues(); return { ok: true, message: `${l.length} competitions available` }; }
      catch (e) { return { ok: false, message: (e as Error).message }; }
    },
  };
}
