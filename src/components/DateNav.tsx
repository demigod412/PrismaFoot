import { addDays } from "date-fns";
import { fmtIn } from "@/lib/time";
import { tz } from "@/lib/tz";
import { FIXTURE_WINDOW_DAYS } from "@/lib/window";
import { DateStrip, type DayChip } from "./DateStrip";

/** Today → end of the fixture window, in the device's timezone. */
export async function DateNav({ active, base, extra = "" }: { active: string; base: string; extra?: string }) {
  const zone = await tz();
  const now = new Date();
  const days: DayChip[] = Array.from({ length: FIXTURE_WINDOW_DAYS + 1 }, (_, i) => {
    const d = addDays(now, i);
    return { key: fmtIn(d, zone, "yyyy-MM-dd"), top: i === 0 ? "Today" : i === 1 ? "Tmrw" : fmtIn(d, zone, "EEE"), num: fmtIn(d, zone, "d MMM") };
  });
  return <DateStrip days={days} active={active} base={base} extra={extra} />;
}
