/** Legacy SQL/API compatibility model only. Current v14 business rules live in plugin-runtime/src/core. */
export interface Project {
  id: string;
  title: string;
  created: string;
}
export type RepeatKind = "none" | "daily" | "weekly" | "monthly";
export interface RepeatRule {
  kind: RepeatKind;
  days: number[];
}
export type TaskStatus = "todo" | "doing" | "done";
export interface Task {
  repeat: RepeatRule;
  doneDates: string[];
  skipDates: string[];
  startDate: string;
  endDate: string;
  occurrenceDone?: boolean;
  projectId: string | null;
  id: string;
  title: string;
  category: string;
  date: string;
  estimate: number;
  status: TaskStatus;
  created: string;
  updated: string;
}
export interface TimeRecord {
  id: string;
  date: string;
  start: string;
  minutes: number;
  category: string;
  title: string;
  taskId: string | null;
  estimatedMinutes: number | null;
  created: string;
}
export const isDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export const isTime = (value: string): boolean =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const actualMinutes = (records: Pick<TimeRecord, "minutes">[]): number =>
  records.reduce((sum, r) => sum + r.minutes, 0);

/** Date projection aligned with the existing plugin's daily/weekly/monthly rules. */
export function occursOn(
  t: Pick<
    Task,
    "date" | "created" | "startDate" | "endDate" | "repeat" | "skipDates"
  >,
  date: string,
): boolean {
  if (!isDate(date) || t.skipDates.includes(date)) return false;
  if (t.repeat.kind === "none") return t.date === date;
  if (t.startDate && date < t.startDate) return false;
  if (t.endDate && date > t.endDate) return false;
  if (t.created && date < t.created.slice(0, 10) && !t.startDate) return false;
  const d = new Date(`${date}T12:00:00Z`);
  if (t.repeat.kind === "daily") return true;
  if (t.repeat.kind === "weekly")
    return t.repeat.days.includes(((d.getUTCDay() + 6) % 7) + 1);
  if (t.repeat.kind === "monthly")
    return t.repeat.days.includes(d.getUTCDate());
  return false;
}
export function doneOn(
  t: Pick<Task, "status" | "repeat" | "doneDates">,
  date: string,
): boolean {
  return t.repeat.kind === "none"
    ? t.status === "done"
    : t.doneDates.includes(date);
}

/** Actual logged time may overlap: totals and coverage must be kept separate. */
export function dayTimeStats(
  spans: readonly Pick<TimeRecord, "start" | "minutes">[],
) {
  let recordedMinutes = 0,
    inDayMinutes = 0,
    invalidCount = 0,
    coveredMinutes = 0,
    lastEnd = 0;
  const intervals: [number, number][] = [];
  for (const span of spans) {
    if (span.minutes <= 0) continue;
    recordedMinutes += span.minutes;
    if (!isTime(span.start) || !Number.isFinite(span.minutes)) {
      invalidCount++;
      continue;
    }
    const [h, m] = span.start.split(":").map(Number),
      start = h * 60 + m;
    if (start + span.minutes > 1440) invalidCount++;
    const end = Math.min(1440, start + span.minutes);
    inDayMinutes += end - start;
    if (end > start) intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  for (const [start, end] of intervals) {
    coveredMinutes += Math.max(0, end - Math.max(start, lastEnd));
    lastEnd = Math.max(lastEnd, end);
  }
  return {
    recordedMinutes,
    coveredMinutes,
    overlapMinutes: Math.max(0, inDayMinutes - coveredMinutes),
    emptyMinutes: 1440 - coveredMinutes,
    invalidCount,
  };
}
