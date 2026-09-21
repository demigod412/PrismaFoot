import Link from "next/link";
export const dynamic = "force-static";
export default function Offline() {
  return (
    <div className="glass mx-auto mt-10 max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">You are offline</h1>
      <p className="mt-2 text-sm text-slate-400">Pages you opened recently are still available. New fixtures and results load when you reconnect.</p>
      <Link href="/" className="focus-ring mt-4 inline-block text-sm text-edge underline underline-offset-4">Try today’s fixtures</Link>
    </div>
  );
}
