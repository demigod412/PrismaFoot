import "server-only";
import { fetchJson } from "./http";
import type { FootballProvider, FxStatus, PFixture, PLeague } from "./types";

/* Sportmonks v3 — optional paid source; the only adapter here that returns xG. */
type SmParticipant = { id: number; name: string; short_code?: string; image_path?: string; meta: { location: "home" | "away" } };
type SmFixture = {
  id: number; league_id: number; season_id: number; starting_at: string; state_id: number;
  participants?: SmParticipant[];
  scores?: { participant_id: number; description: string; score: { goals: number } }[];
  xgfixture?: { participant_id: number; type_id: number; data: { value: number } }[];
  sidelined?: { participant_id: number; sideline: { player_id: number; category: string } }[];
  lineups?: { team_id: number; player_name: string; type_id: number }[];
};
// Sportmonks state ids: 1 NS, 2 LIVE(1st), 3 HT, 5 FT, 7 AET, 8 FT_PEN, 10 POSTP, 13 CANCL, 22 2nd half
const mapState = (s: number): FxStatus =>
  [5, 7, 8].includes(s) ? "FINISHED" : [2, 3, 4, 6, 9, 22, 23].includes(s) ? "LIVE"
  : s === 10 ? "POSTPONED" : [11, 12, 13, 14, 15, 16].includes(s) ? "CANCELLED" : "SCHEDULED";

export function sportmonks(token: string, base = process.env.SPORTMONKS_BASE_URL ?? "https://api.sportmonks.com/v3/football"): FootballProvider {
  const get = async <T>(path: string, extra = "") => {
    const sep = path.includes("?") ? "&" : "?";
    return (await fetchJson<{ data: T }>("sportmonks", `${base}${path}${sep}api_token=${token}${extra}`, {})).data;
  };
  const toFx = (f: SmFixture): PFixture => {
    const h = f.participants?.find((p) => p.meta.location === "home");
    const a = f.participants?.find((p) => p.meta.location === "away");
    const cur = (pid?: number) => f.scores?.find((s) => s.participant_id === pid && s.description === "CURRENT")?.score.goals ?? null;
    const xg = (pid?: number) => f.xgfixture?.find((x) => x.participant_id === pid && x.type_id === 5304)?.data.value ?? null;
    return {
      externalId: String(f.id), leagueExternalId: String(f.league_id), season: f.season_id,
      kickoffUtc: new Date(f.starting_at.replace(" ", "T") + "Z"), status: mapState(f.state_id),
      home: { externalId: String(h?.id), name: h?.name ?? "Home", shortName: h?.short_code, crestUrl: h?.image_path },
      away: { externalId: String(a?.id), name: a?.name ?? "Away", shortName: a?.short_code, crestUrl: a?.image_path },
      homeGoals: cur(h?.id), awayGoals: cur(a?.id), homeXg: xg(h?.id), awayXg: xg(a?.id),
    };
  };
  const inc = "&include=participants;scores;xGFixture";

  return {
    id: "sportmonks",
    async getLeagues() {
      const r = await get<{ id: number; name: string; short_code?: string; country?: { name: string }; currentseason?: { name: string } }[]>("/leagues", "&include=country;currentSeason");
      return r.map<PLeague>((l) => ({ externalId: String(l.id), name: l.name, country: l.country?.name ?? "", code: l.short_code, season: Number(l.currentseason?.name?.slice(0, 4) ?? new Date().getFullYear()) }));
    },
    async getFixtures({ from, to, leagueId }) {
      return (await get<SmFixture[]>(`/fixtures/between/${from}/${to}`, `${inc}&filters=fixtureLeagues:${leagueId}`)).map(toFx);
    },
    async getFixture(id) {
      const f = await get<SmFixture>(`/fixtures/${id}`, "&include=lineups;participants;scores;xGFixture;sidelined");
      return f ? toFx(f) : null;
    },
    async getResults({ date }) {
      return (await get<SmFixture[]>(`/fixtures/date/${date}`, inc)).map(toFx).filter((f) => f.status === "FINISHED");
    },
    async getStandings() { return []; }, // add /standings/seasons/{id} in Phase 3
    async getH2H(homeId, awayId) {
      return (await get<SmFixture[]>(`/fixtures/head-to-head/${homeId}/${awayId}`, inc)).map(toFx);
    },
    async getLineups(fixtureId) {
      const f = await get<SmFixture>(`/fixtures/${fixtureId}`, "&include=lineups;participants");
      if (!f.lineups?.length) return null;
      const h = f.participants?.find((p) => p.meta.location === "home")?.id;
      const starters = (tid?: number) => f.lineups!.filter((l) => l.team_id === tid && l.type_id === 11).map((l) => l.player_name);
      const a = f.participants?.find((p) => p.meta.location === "away")?.id;
      return { homeStarters: starters(h), awayStarters: starters(a), confirmed: true };
    },
    async getInjuries(fixtureId) {
      const f = await get<SmFixture>(`/fixtures/${fixtureId}`, "&include=sidelined.sideline");
      if (!f.sidelined) return null;
      return f.sidelined.map((s) => ({ teamExternalId: String(s.participant_id), player: String(s.sideline.player_id), reason: s.sideline.category, confirmedOut: true }));
    },
    async getXg(fixtureId) {
      const f = await this.getFixture(fixtureId);
      return f?.homeXg != null && f.awayXg != null ? { home: f.homeXg, away: f.awayXg } : null;
    },
    async getOdds() { return []; },
    async testConnection() {
      try { const l = await get<unknown[]>("/leagues", "&per_page=1"); return { ok: true, message: `Connected (${l.length ? "leagues visible" : "no leagues on plan"})` }; }
      catch (e) { return { ok: false, message: (e as Error).message }; }
    },
  };
}
