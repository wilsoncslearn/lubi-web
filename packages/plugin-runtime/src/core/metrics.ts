// 时间统计只用于展示，不回写日记。记录时长可因并行事件重复计数；覆盖时间必须取区间并集。
import { hmToMin } from "./time";

export interface TimedSpan {
  start: string;
  minutes: number;
}

export interface DayTimeStats {
  recordedMinutes: number;
  coveredMinutes: number;
  overlapMinutes: number;
  emptyMinutes: number;
  invalidCount: number;
}

/** 手写旧数据可能跨出当天；提示用户修正，但统计覆盖时只计入当日 00:00–24:00。 */
function validClock(value: string): boolean {
  return /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value);
}

export function invalidTimedSpan(span: TimedSpan): boolean {
  if (!(span.minutes > 0)) return false;
  if (!validClock(span.start)) return true;
  const start = hmToMin(span.start);
  return !Number.isFinite(span.minutes) || start + span.minutes > 1440;
}

export function dayTimeStats(spans: readonly TimedSpan[]): DayTimeStats {
  let recordedMinutes = 0;
  let inDayMinutes = 0;
  let invalidCount = 0;
  const intervals: [number, number][] = [];
  for (const span of spans) {
    if (!(span.minutes > 0)) continue; // 财务记录不占用时间轴
    if (invalidTimedSpan(span)) invalidCount++;
    if (!Number.isFinite(span.minutes)) continue;
    recordedMinutes += span.minutes;
    if (!validClock(span.start)) continue;
    const start = Math.max(0, Math.min(1440, hmToMin(span.start)));
    const end = Math.max(start, Math.min(1440, hmToMin(span.start) + span.minutes));
    if (end > start) {
      inDayMinutes += end - start;
      intervals.push([start, end]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let coveredMinutes = 0;
  let lastEnd = 0;
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
