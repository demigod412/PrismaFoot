import { Card, SectionTitle } from "@/components/ui";
import { getSetting, secretSource, SECRET_NAMES } from "@/lib/secrets";
import { primaryProviderId } from "@/lib/providers";
import { DEFAULT_FLOORS, type ScannerFloors } from "@/lib/scanners";
import { dataMode } from "@/lib/mode";
import { DEFAULT_TZ, fmtIn, tzOffsetLabel, TZ_COOKIE } from "@/lib/time";
import { tz } from "@/lib/tz";
import { cookies } from "next/headers";
import { isAdmin } from "./actions";
import { AccessCodeForm, FloorsForm, KeysForm, PrefsForm, TimezoneForm, UnlockForm } from "./forms";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const admin = await isAdmin();
  const zone = await tz();
  const zoneIsDefault = !(await cookies()).get(TZ_COOKIE)?.value;
  const mode = await dataMode();
  const sources = Object.fromEntries(await Promise.all(SECRET_NAMES.map(async (n) => [n, await secretSource(n)] as const)));
  const codeSet = (await getSetting<unknown>("accessCode", null)) != null;
  const floors = { ...DEFAULT_FLOORS, ...(await getSetting<Partial<ScannerFloors>>("scannerFloors", {})) };
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <SectionTitle aside={mode.lastSync ? `last sync ${fmtIn(mode.lastSync, zone, "d MMM HH:mm")} ${tzOffsetLabel(zone, mode.lastSync)}` : "never synced"}>Data sources</SectionTitle>
        <p className="mb-4 text-xs text-slate-400">{mode.demo ? "Demo mode is on because the primary provider has no usable key or has not synced yet." : `Live data from ${mode.provider.toLowerCase()}.`} Keys stay on the server. Pages read from the database cache, never from the provider directly.</p>
        {admin ? <KeysForm sources={sources} primary={await primaryProviderId()} /> : <UnlockForm />}
      </Card>
      <Card className="mb-4">
        <SectionTitle aside={codeSet ? "set" : "not set"}>Access code</SectionTitle>
        {admin ? <AccessCodeForm isSet={codeSet} /> : <p className="text-xs text-slate-400">Unlock with your PIN above to set or change the access code.</p>}
      </Card>
      <Card>
        <SectionTitle>Scanner floors</SectionTitle>
        {admin ? <FloorsForm floors={floors as unknown as Record<string, number>} /> : <p className="text-sm text-slate-400">Unlock above to edit. Current Safe floor: <span className="num">{floors.safeP}</span>.</p>}
      </Card>
      <Card>
        <SectionTitle aside={tzOffsetLabel(zone)}>Display</SectionTitle>
        <p className="mb-4 text-sm text-slate-400">
          Kickoff times in <span className="text-slate-200">{zone.replace(/_/g, " ")}</span> with UTC underneath
          {zoneIsDefault ? <> — the server default (<span className="num">DEFAULT_TIMEZONE</span>, currently {DEFAULT_TZ.replace(/_/g, " ")}).</> : <>, chosen on this device.</>}
        </p>
        <TimezoneForm current={zoneIsDefault ? DEFAULT_TZ : zone} isDefault={zoneIsDefault} />
        {admin && <div className="mt-4 border-t hairline pt-4"><PrefsForm bookie={await getSetting("defaultBookie", "sportybet")} /></div>}
      </Card>
    </div>
  );
}
