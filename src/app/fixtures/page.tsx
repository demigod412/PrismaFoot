import { redirect } from "next/navigation";

/**
 * The fixtures board moved to the landing page. Kept as a redirect so old links,
 * bookmarks, installed-PWA start URLs and shared day links still land in the right place.
 * Deliberately temporary (307): a permanent redirect gets cached hard by installed PWAs,
 * which would be painful to undo.
 */
export default async function FixturesMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s) q.set(k, s);
  }
  const query = q.toString();
  redirect(`/${query ? `?${query}` : ""}`);
}
