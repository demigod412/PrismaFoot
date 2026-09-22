const TEXT: Record<string, string> = {
  missing_news: "Lineups and injuries not confirmed",
  missing_rest: "Rest days unknown",
  thin_sample: "Few recent matches for at least one side",
  goals_only_ratings: "Ratings built from goals (no xG feed)",
  new_team_home: "Home side has no history here; league average used",
  new_team_away: "Away side has no history here; league average used",
  no_corner_data: "Corners not available yet (needs match statistics history)",
  no_shot_data: "Total shots not available yet (needs match statistics history)",
  early_season: "Early season: few matches this season, last season still carries weight",
  prior_home: "Home side is new to this league: rating starts from its record in the league it came from",
  prior_away: "Away side is new to this league: rating starts from its record in the league it came from",
  late_lock: "Locked late (server was busy): this call is excluded from scoring",
  neutral_venue: "Tournament match at a neutral venue: no home advantage applied",
  low_band_capped: "Low confidence: displayed probabilities capped below 90%",
};
export function DataFlags({ flags }: { flags: string[] }) {
  if (!flags.length) return <p className="text-xs text-slate-400">All inputs present.</p>;
  return (
    <ul className="space-y-1 text-xs text-slate-300">
      {flags.map((f) => <li key={f} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ice" />{TEXT[f] ?? f}</li>)}
    </ul>
  );
}
