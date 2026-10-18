import { occursOn, Task } from "./tasks";
import { eachDate, hmToMin, isValidDate, monthEnd, monthStart, parseDate, dateStr, shiftDate, weekStart } from "./time";

export interface GanttSegment { from: string; to: string; done: boolean }
export interface GanttRow { task: Task; depth: number; segments: GanttSegment[]; summary: boolean; hasChildren: boolean }
export type GanttAction = "move" | "start" | "end";
export type GanttPatch = Partial<Pick<Task, "date" | "startDate" | "endDate">>;

export type GanttPeriod = "day" | "week" | "month";

export function ganttWindow(anchor: string, period: GanttPeriod = "week"): string[] {
  if (period === "day") return [anchor];
  if (period === "month") return eachDate(monthStart(anchor), monthEnd(anchor));
  const from = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => shiftDate(from, i));
}

/** Natural-month navigation clamps the selected day instead of overflowing into a later month. */
export function stepGanttDate(anchor: string, period: GanttPeriod, direction: number): string {
  if (period !== "month") return shiftDate(anchor, direction * (period === "week" ? 7 : 1));
  const target = parseDate(monthStart(anchor));
  target.setMonth(target.getMonth() + direction);
  const first = dateStr(target), day = Math.min(Number(anchor.slice(8, 10)), Number(monthEnd(first).slice(8, 10)));
  return `${first.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

export function explicitSpan(task: Task): { from: string; to: string } | null {
  return isValidDate(task.startDate) && isValidDate(task.endDate) && task.startDate <= task.endDate
    ? { from: task.startDate, to: task.endDate } : null;
}

/** A view projection only; derived ranges are never written back to tasks. */
export function ganttRows(tasks: Task[], days: string[], collapsed = new Set<string>()): GanttRow[] {
  if (!days.length) return [];
  const from = days[0], to = days[days.length - 1];
  const visibleTasks = tasks.filter(t => t.origin !== "record");
  const byId = new Map(visibleTasks.map(t => [t.id, t]));
  const children = new Map<string, Task[]>();
  const sort = (a: Task, b: Task) => a.order - b.order || a.created.localeCompare(b.created) || a.id.localeCompare(b.id);
  for (const t of visibleTasks) if (t.parent && byId.has(t.parent)) {
    const list = children.get(t.parent) || []; list.push(t); children.set(t.parent, list);
  }
  for (const list of children.values()) list.sort(sort);
  const cache = new Map<string, { segments: GanttSegment[]; summary: boolean; relevant: boolean }>();
  const computing = new Set<string>();
  const intersects = (s: GanttSegment) => s.from <= to && s.to >= from;
  const project = (t: Task): { segments: GanttSegment[]; summary: boolean; relevant: boolean } => {
    const cached = cache.get(t.id); if (cached) return cached;
    if (computing.has(t.id)) return { segments: [], summary: true, relevant: false };
    computing.add(t.id);
    const kids = (children.get(t.id) || []).map(project);
    const span = explicitSpan(t);
    let segments: GanttSegment[] = [], summary = false;
    if (t.repeat.kind !== "none") {
      segments = days.filter(d => occursOn(t, d)).map(d => ({ from: d, to: d, done: t.doneDates.includes(d) }));
    } else if (span) segments = [{ ...span, done: t.status === "done" }];
    else if (kids.length) {
      summary = true;
      const ranges = kids.flatMap(k => k.segments);
      if (isValidDate(t.date)) ranges.push({ from: t.date, to: t.date, done: t.status === "done" });
      if (ranges.length) segments = [{ from: ranges.map(s => s.from).sort()[0], to: ranges.map(s => s.to).sort()[ranges.length - 1], done: t.status === "done" }];
    } else if (isValidDate(t.date)) segments = [{ from: t.date, to: t.date, done: t.status === "done" }];
    const result = { segments, summary, relevant: segments.some(intersects) || kids.some(k => k.relevant) };
    computing.delete(t.id); cache.set(t.id, result); return result;
  };
  visibleTasks.forEach(project);
  const out: GanttRow[] = [], seen = new Set<string>();
  const walk = (t: Task, depth: number) => {
    if (seen.has(t.id)) return; seen.add(t.id);
    const data = project(t); if (!data.relevant) return;
    const kids = children.get(t.id) || [];
    out.push({ task: t, depth, segments: data.segments.filter(intersects), summary: data.summary, hasChildren: kids.length > 0 });
    if (!collapsed.has(t.id)) for (const child of kids) walk(child, depth + 1);
    else {
      const mark = (child: Task) => { if (seen.has(child.id)) return; seen.add(child.id); (children.get(child.id) || []).forEach(mark); };
      kids.forEach(mark);
    }
  };
  visibleTasks.filter(t => !t.parent || !byId.has(t.parent)).sort(sort).forEach(t => walk(t, 0));
  // Defensive fallback for old malformed cycles: render once, never recurse forever.
  visibleTasks.sort(sort).forEach(t => walk(t, 0));
  return out;
}

/** Actionable allocations: preserve explicitly scheduled parents, not derived summaries. */
export function scheduledPlanRows(tasks: Task[], days: string[]): GanttRow[] {
  return ganttRows(tasks, days).flatMap(row => {
    if (!row.hasChildren || !row.summary) return row.segments.length ? [row] : [];
    const task = row.task;
    if (isValidDate(task.date) && task.date >= days[0] && task.date <= days[days.length - 1]) {
      return [{ ...row, summary: false, segments: [{ from: task.date, to: task.date, done: task.status === "done" }] }];
    }
    return [];
  });
}

/** Inclusive day intervals; resize cannot exclude the scheduled execution day. */
export function ganttPatch(task: Task, action: GanttAction, delta: number): GanttPatch | null {
  if (task.repeat.kind !== "none" || !Number.isFinite(delta)) return null;
  delta = Math.round(delta); if (!delta) return {};
  let span = explicitSpan(task);
  if (!span) {
    if (!isValidDate(task.date) || task.startDate || task.endDate) return null;
    if (action === "move") {
      const date = shiftDate(task.date, delta);
      return isValidDate(date) ? { date } : null;
    }
    span = { from: task.date, to: task.date };
  }
  if (task.date && (!isValidDate(task.date) || task.date < span.from || task.date > span.to)) return null;
  const scheduled = isValidDate(task.date) ? task.date : "";
  let from = span.from, to = span.to;
  if (action === "move") { from = shiftDate(from, delta); to = shiftDate(to, delta); }
  else if (action === "start") {
    from = shiftDate(from, delta);
    const bound = scheduled || to;
    if (from > bound) from = bound;
  } else {
    to = shiftDate(to, delta);
    const bound = scheduled || from;
    if (to < bound) to = bound;
  }
  if (!isValidDate(from) || !isValidDate(to) || from > to) return null;
  const patch: GanttPatch = {};
  if (from !== span.from || (!task.startDate && from !== to)) patch.startDate = from;
  if (to !== span.to || (!task.endDate && from !== to)) patch.endDate = to;
  if (action === "move" && scheduled) {
    const date = shiftDate(scheduled, delta);
    if (!isValidDate(date)) return null;
    patch.date = date;
  }
  return patch;
}

export interface DailyGanttRow { task: Task; start: number | null; minutes: number; visibleMinutes: number; done: boolean }

/** Scheduled allocations, including explicit parent plans; never actual-record tasks. */
export function dailyGanttRows(tasks: Task[], date: string): DailyGanttRow[] {
  return scheduledPlanRows(tasks, [date]).map(({ task }) => {
    const isTimed = !explicitSpan(task) || task.date === date || task.repeat.kind !== "none";
    const start = isTimed && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.start) ? hmToMin(task.start) : null;
    const minutes = Number.isFinite(task.estimate) && task.estimate > 0 ? task.estimate : 0;
    return { task, start, minutes, visibleMinutes: start === null ? 0 : Math.min(minutes, 1440 - start), done: task.repeat.kind === "none" ? task.status === "done" : task.doneDates.includes(date) };
  }).sort((a, b) => (a.start ?? 1440) - (b.start ?? 1440) || a.task.order - b.task.order || a.task.created.localeCompare(b.task.created));
}
