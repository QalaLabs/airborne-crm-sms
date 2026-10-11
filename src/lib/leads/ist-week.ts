/**
 * Calendar weeks in IST (Asia/Kolkata, UTC+05:30), Monday 00:00:00.000 to
 * Sunday 23:59:59.999. Week keys are the IST date of the Monday (`YYYY-MM-DD`).
 */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const WEEK_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ISTWeek {
  /** Monday (IST) as `YYYY-MM-DD`. */
  key: string;
  /** UTC instant of Monday 00:00 IST. */
  start: Date;
  /** UTC instant of Sunday 23:59:59.999 IST. */
  end: Date;
  /** Sunday (IST) as `YYYY-MM-DD`. */
  endKey: string;
  label: string;
}

function istDateKey(utcMidnightOfIstDay: number): string {
  return new Date(utcMidnightOfIstDay).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Week containing the given instant. */
export function istWeekContaining(instant: Date): ISTWeek {
  const shifted = instant.getTime() + IST_OFFSET_MS;
  const istMidnight = Math.floor(shifted / DAY_MS) * DAY_MS;
  const dow = new Date(istMidnight).getUTCDay(); // 0 = Sunday
  const mondayWall = istMidnight - ((dow + 6) % 7) * DAY_MS;
  const sundayWall = mondayWall + 6 * DAY_MS;
  const key = istDateKey(mondayWall);
  const endKey = istDateKey(sundayWall);
  return {
    key,
    start: new Date(mondayWall - IST_OFFSET_MS),
    end: new Date(mondayWall + 7 * DAY_MS - IST_OFFSET_MS - 1),
    endKey,
    label: `${shortDate(key)} – ${shortDate(endKey)}`,
  };
}

/**
 * Parses a week key (any IST date inside the week is accepted and snapped to
 * its Monday). Returns null for malformed or impossible dates.
 */
export function parseISTWeek(value: string): ISTWeek | null {
  const m = WEEK_KEY_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wall = Date.UTC(y, mo - 1, d);
  const check = new Date(wall);
  if (y < 2000 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return istWeekContaining(new Date(wall - IST_OFFSET_MS));
}

export function shiftISTWeek(week: ISTWeek, deltaWeeks: number): ISTWeek {
  return istWeekContaining(new Date(week.start.getTime() + deltaWeeks * 7 * DAY_MS));
}
