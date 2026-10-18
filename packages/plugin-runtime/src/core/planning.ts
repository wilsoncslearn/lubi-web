// Shared, read-only projection for calendar and list; date Gantt uses the same segments.
import { scheduledPlanRows, explicitSpan, ganttPatch, GanttPatch } from "./gantt";
import { Task } from "./tasks";
import { daysBetween, eachDate, hmToMin, isValidDate, monthEnd, monthStart, shiftDate, weekStart } from "./time";

export interface PlanOccurrence { task: Task; date: string; from: string; to: string; done: boolean; timed: boolean }

/** Derived summaries are headings; explicitly scheduled parents remain plans. */
export function planOccurrences(tasks: Task[], days: string[]): PlanOccurrence[] {
  if (!days.length) return [];
  const first = days[0], last = days[days.length - 1];
  return scheduledPlanRows(tasks, days).flatMap(row => row.segments.map(segment => {
    const date = row.task.date >= first && row.task.date <= last && row.task.date >= segment.from && row.task.date <= segment.to
      ? row.task.date : segment.from < first ? first : segment.from;
    return { task: row.task, date, from: segment.from, to: segment.to, done: segment.done,
      timed: !!row.task.start && (!explicitSpan(row.task) || row.task.date === date || row.task.repeat.kind !== "none") };
  })).sort((a, b) => a.date.localeCompare(b.date) || (a.timed ? hmToMin(a.task.start) : 1440) - (b.timed ? hmToMin(b.task.start) : 1440)
    || a.task.order - b.task.order || a.task.created.localeCompare(b.task.created) || a.task.id.localeCompare(b.task.id));
}

export function monthCalendarDays(date: string): string[] {
  const first = weekStart(monthStart(date)), last = shiftDate(weekStart(monthEnd(date)), 6);
  return eachDate(first, last);
}

export function planInbox(tasks: Task[]): Task[] {
  const parents = new Set(tasks.map(t => t.parent).filter(Boolean));
  return tasks.filter(t => t.origin !== "record" && !t.date && !explicitSpan(t) && t.repeat.kind === "none" && t.status !== "done" && !parents.has(t.id))
    .sort((a, b) => a.order - b.order || a.created.localeCompare(b.created));
}

/** Calendar date moves preserve clock time and shift explicit spans together. */
export function planDatePatch(task: Task, date: string, sourceDate?: string): GanttPatch | null {
  if (!isValidDate(date) || task.repeat.kind !== "none") return null;
  const span = explicitSpan(task);
  if (task.startDate || task.endDate) {
    if (!span) return null;
    const from = sourceDate || task.date || span.from;
    if (!isValidDate(from) || from < span.from || from > span.to) return null;
    return ganttPatch(task, "move", daysBetween(from, date));
  }
  if (sourceDate && task.date && sourceDate !== task.date) return null;
  return { date };
}
