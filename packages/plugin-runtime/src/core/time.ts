// 日期 / 时间小工具。所有日期均为本地 YYYY-MM-DD，时间为 HH:MM。

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayStr(): string {
  return dateStr(new Date());
}

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export function shiftDate(s: string, days: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return dateStr(d);
}

export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

export function nowHM(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hmToMin(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minToHM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function fmtDuration(min: number): string {
  if (!min) return "0min";
  if (min < 60) return `${Math.round(min)}min`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(h < 10 ? 2 : 1).replace(/\.?0+$/, "")}h`;
}

export function fmtHours(min: number): string {
  const h = min / 60;
  return h.toFixed(1).replace(/\.0$/, "") + "h";
}

/** 周一为一周开始 */
export function weekStart(s: string): string {
  const d = parseDate(s);
  const dow = (d.getDay() + 6) % 7;
  return shiftDate(s, -dow);
}

export function monthStart(s: string): string {
  return s.slice(0, 7) + "-01";
}

export function monthEnd(s: string): string {
  const d = parseDate(monthStart(s));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return dateStr(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let s = from; s <= to; s = shiftDate(s, 1)) out.push(s);
  return out;
}

export const WEEKDAY_ZH = ["一", "二", "三", "四", "五", "六", "日"];

export function weekdayZh(s: string): string {
  return WEEKDAY_ZH[(parseDate(s).getDay() + 6) % 7];
}

export function shortDate(s: string): string {
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
}

export function uid(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stamp(): string {
  const d = new Date();
  return `${dateStr(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
