export type ProviderId = "football-data" | "api-football" | "sportmonks" | "demo";
export type FxStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";

export interface PTeam { externalId: string; name: string; shortName?: string; crestUrl?: string }
export interface PLeague { externalId: string; name: string; country: string; code?: string; season: number }
export interface PFixture {
  externalId: string; leagueExternalId: string; season: number; round?: string;
  kickoffUtc: Date; status: FxStatus; home: PTeam; away: PTeam;
  homeGoals?: number | null; awayGoals?: number | null;
  homeXg?: number | null; awayXg?: number | null;
  homeShots?: number | null; awayShots?: number | null; venue?: string;
}
export interface PStanding { team: PTeam; position: number; played: number; points: number; goalsFor: number; goalsAgainst: number; form?: string }
export interface PLineups { homeStarters: string[]; awayStarters: string[]; confirmed: boolean }
export interface PInjury { teamExternalId: string; player: string; reason: string; confirmedOut: boolean }
export interface PXg { home: number; away: number }
export interface POdds { bookmaker: string; home: number; draw: number; away: number; over25?: number; under25?: number }

/** Every adapter implements this. Unsupported calls return empty/null — never throw for "not supported". */
export interface FootballProvider {
  id: ProviderId;
  getLeagues(): Promise<PLeague[]>;
  getFixtures(q: { from?: string; to?: string; leagueId: string; season: number }): Promise<PFixture[]>; // no from/to = whole season
  getFixture(id: string): Promise<PFixture | null>;
  getResults(q: { date: string }): Promise<PFixture[]>;
  getStandings(leagueId: string, season: number): Promise<PStanding[]>;
  getH2H(homeId: string, awayId: string): Promise<PFixture[]>;
  getLineups(fixtureId: string): Promise<PLineups | null>;
  getInjuries(fixtureId: string): Promise<PInjury[] | null>; // null = unsupported/not fetched
  getXg(fixtureId: string): Promise<PXg | null>;
  getOdds(fixtureId: string): Promise<POdds[]>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
