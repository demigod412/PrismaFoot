import Link from "next/link";
export function DemoBanner({ demo, lastSync }: { demo: boolean; lastSync: Date | null }) {
  if (!demo) return null;
  return (
    <div className="sticky top-0 z-40 border-b border-ice/20 bg-ice/10 px-4 py-2 text-center text-xs text-ice backdrop-blur">
      Demo mode: fictional clubs and simulated results, rated by the real model.{" "}
      <Link href="/settings" className="underline underline-offset-2">Add a data key</Link> to switch to live fixtures.
      {lastSync && <span className="sr-only"> Seeded {lastSync.toISOString()}</span>}
    </div>
  );
}
