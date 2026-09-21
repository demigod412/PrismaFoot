import { Card, SectionTitle } from "@/components/ui";
import { getSetting, secretSource, SECRET_NAMES } from "@/lib/secrets";
import { primaryProviderId } from "@/lib/providers";
import { DEFAULT_FLOORS, type ScannerFloors } from "@/lib/scanners";
import { dataMode } from "@/lib/mode";
import { fmtWat, TZ } from "@/lib/time";
import { isAdmin } from "./actions";
import { FloorsForm, KeysForm, PrefsForm, UnlockForm } from "./forms";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const admin = await isAdmin();
  const mode = await dataMode();
  const sources = Object.fromEntries(await Promise.all(SECRET_NAMES.map(async (n) => [n, await secretSource(n)] as const)));
  const floors = { ...DEFAULT_FLOORS, ...(await getSetting<Partial<ScannerFloors>>("scannerFloors", {})) };
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <SectionTitle aside={mode.lastSync ? `last sync ${fmtWat(mode.lastSync, "d MMM HH:mm")} WAT` : "never synced"}>Data sources</SectionTitle>
        <p className="mb-4 text-xs text-slate-400">{mode.demo ? "Demo mode is on because the primary provider has no usable key or has not synced yet." : `Live data from ${mode.provider.toLowerCase()}.`} Keys stay on the server. Pages read from the database cache, never from the provider directly.</p>
        {admin ? <KeysForm sources={sources} primary={await primaryProviderId()} /> : <UnlockForm />}
      </Card>
      <Card>
        <SectionTitle>Scanner floors</SectionTitle>
        {admin ? <FloorsForm floors={floors as unknown as Record<string, number>} /> : <p className="text-sm text-slate-400">Unlock above to edit. Current Safe floor: <span className="num">{floors.safeP}</span>.</p>}
      </Card>
      <Card>
        <SectionTitle>Display</SectionTitle>
        <p className="text-sm text-slate-400">Kickoff times in <span className="text-slate-200">{TZ}</span> with UTC underneath. Change with DEFAULT_TIMEZONE.</p>
        {admin && <div className="mt-4"><PrefsForm bookie={await getSetting("defaultBookie", "sportybet")} /></div>}
      </Card>
    </div>
  );
}
