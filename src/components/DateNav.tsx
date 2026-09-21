import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { TZ } from "@/lib/time";
import { DateStrip, type DayChip } from "./DateStrip";

/** Today → +14 days, in WAT. */
export function DateNav({ active, base, extra = "" }: { active: string; base: string; extra?: string }) {
  const now = new Date();
  const days: DayChip[] = Array.from({ length: 15 }, (_, i) => {
    const d = addDays(now, i);
    return { key: formatInTimeZone(d, TZ, "yyyy-MM-dd"), top: i === 0 ? "Today" : i === 1 ? "Tmrw" : formatInTimeZone(d, TZ, "EEE"), num: formatInTimeZone(d, TZ, "d MMM") };
  });
  return <DateStrip days={days} active={active} base={base} extra={extra} />;
}
