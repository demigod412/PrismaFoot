const TEXT: Record<string, string> = {
  missing_news: "Lineups and injuries not confirmed",
  missing_rest: "Rest days unknown",
  thin_sample: "Few recent matches for at least one side",
  goals_only_ratings: "Ratings built from goals (no xG feed)",
  new_team_home: "Home side has no history here; league average used",
  new_team_away: "Away side has no history here; league average used",
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
