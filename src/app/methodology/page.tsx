import { Card, SectionTitle } from "@/components/ui";
import { MODEL_VERSION, HALF_LIFE_DAYS, DEFAULT_RHO, CALIBRATION_MIN_N, ISOTONIC_MIN_N } from "@/lib/model/constants";
import { dataMode } from "@/lib/mode";

export const metadata = { title: "Methodology" };
const F = ({ children }: { children: React.ReactNode }) => <pre className="num my-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-[12px] leading-relaxed text-slate-200">{children}</pre>;

export default async function Methodology() {
  const mode = await dataMode();
  return (
    <div className="max-w-3xl space-y-4 text-sm leading-relaxed text-slate-300">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">How the numbers are made</h1>
        <p className="mt-1 text-slate-400">Model <span className="num text-edge">{MODEL_VERSION}</span>. Every user sees the same output. Data source: {mode.demo ? "demo (simulated)" : mode.provider.toLowerCase().replace("_", "-")}.</p>
      </header>
      <Card>
        <SectionTitle>What we optimise</SectionTitle>
        <p>Probability quality, scored by Brier and log loss on 1X2. Not raw hit-rate. A model that says 55% should win about 55% of the time.</p>
        <F>{`Brier = mean over matches of Σ_k (p_k − o_k)²,  k ∈ {home, draw, away}
LogLoss = mean of −ln p_outcome`}</F>
        <p>Baselines on the Accuracy page: always-home, league-table favourite, and de-vigged closing odds when an odds feed exists.</p>
      </Card>
      <Card>
        <SectionTitle>1. Team ratings</SectionTitle>
        <p>Each team gets attack α and defence β per league-season from recency-weighted history, preferring xG, then shots, then goals.</p>
        <F>{`w = exp(−ln2 · days_ago / ${HALF_LIFE_DAYS})
E[home goals] = c · a_H · d_A · γ     E[away goals] = c · a_A · d_H
fit by weighted iterative scaling, mean(a) = mean(d) = 1
α = c · a,  β = d,  γ = league home advantage (fit per league)
shrinkage: 4 pseudo-matches at league average per team`}</F>
      </Card>
      <Card>
        <SectionTitle>2. Expected goals for a fixture</SectionTitle>
        <F>{`λ_H = α_H · β_A · γ_league · φ_rest_H · φ_news_H
λ_A = α_A · β_H · φ_rest_A · φ_news_A
φ_rest = clamp(1 + 0.012 · (rest_days − 4), 0.95, 1.03), 1 if unknown
φ_news = max(0.88, 1 − 0.04 · confirmed starter absences), 1 if unknown`}</F>
        <p>Injuries are never guessed. Missing lineups set φ_news = 1 and add the flag missing_news, which lowers confidence.</p>
      </Card>
      <Card>
        <SectionTitle>3. Scorelines (Dixon–Coles)</SectionTitle>
        <F>{`P(i, j) ∝ Pois(i; λ_H) · Pois(j; λ_A) · τ(i, j)
τ(0,0) = 1 − λ_H λ_A ρ     τ(0,1) = 1 + λ_H ρ
τ(1,0) = 1 + λ_A ρ         τ(1,1) = 1 − ρ      τ = 1 elsewhere
matrix 0..10 × 0..10, renormalised to sum to 1
ρ per league: weighted ML grid search on [−0.25, 0.10],
shrunk toward ${DEFAULT_RHO} with 200 prior matches`}</F>
        <p>1X2, Over 1.5/2.5/3.5/4.5, Under 2.5/3.5/4.5, BTTS, the most likely score and the top five scorelines are all sums over this one matrix, so they are always consistent with each other.</p>
      </Card>
      <Card>
        <SectionTitle>4. Calibration</SectionTitle>
        <p>Fitted separately for 1X2 (one-vs-rest, then renormalised), O/U lines and BTTS, from locked predictions that have settled.</p>
        <F>{`n < ${CALIBRATION_MIN_N}          identity (raw probabilities shown)
${CALIBRATION_MIN_N} ≤ n < ${ISOTONIC_MIN_N}    10 equal-count buckets, shrunk toward the diagonal, made monotone
n ≥ ${ISOTONIC_MIN_N}          isotonic regression (pool-adjacent-violators), lightly shrunk`}</F>
        <p>Both raw and calibrated probabilities are stored with the model version. Unders are shown as 1 − calibrated over for the same line, so over and under always add to 100%.</p>
      </Card>
      <Card>
        <SectionTitle>5. Confidence</SectionTitle>
        <F>{`100 − sample penalty (≤30) − 15 if news missing − 20·league volatility
    − 5 if rest gap ≥ 3 days − min(15, 100·calibration residual)
High: ≥ 70, both sides ≥ 8 effective matches, 1X2 margin ≥ 0.15, news complete
Medium: ≥ 45     Low: below. Low calls never display 90% or more.`}</F>
      </Card>
      <Card>
        <SectionTitle>6. Lock and settle</SectionTitle>
        <p>Each call is snapshotted 15 minutes before kickoff with a hash of its inputs. A late lineup change creates a new revision; the locked row is never edited. Results are appended after full time and nothing is deleted.</p>
      </Card>
      <Card>
        <SectionTitle>What the language model does</SectionTitle>
        <p>Nothing numeric. It may reword the four “why this call” bullets built from the features above; any rewrite that changes a number is discarded.</p>
      </Card>
    </div>
  );
}
