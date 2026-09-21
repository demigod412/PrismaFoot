"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const db = /prisma|database|ECONNREFUSED|P1001/i.test(error.message);
  return (
    <div className="glass mx-auto mt-8 max-w-md p-6 text-center">
      <h1 className="text-base font-semibold">{db ? "Can’t reach the database" : "This page failed to load"}</h1>
      <p className="mt-2 text-sm text-slate-400">{db ? "Check DATABASE_URL and that Postgres is running (npm run db:up), then retry." : "The data cache returned an error. Retrying usually fixes it; if not, check the latest sync in Settings."}</p>
      <button onClick={reset} className="focus-ring mt-4 rounded-lg border border-edge/40 px-3 py-1.5 text-sm text-edge hover:bg-edge/10">Retry</button>
    </div>
  );
}
