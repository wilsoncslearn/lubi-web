import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { actualMinutes, isDate, isTime } from './index.ts';
test('actual time excludes estimated snapshots', () => assert.equal(actualMinutes([{ minutes: 30, estimatedMinutes: 90 }, { minutes: 15, estimatedMinutes: 60 }]), 45));
test('validates dates and times', () => { assert.equal(isDate('2026-02-29'), false); assert.equal(isDate('2024-02-29'), true); assert.equal(isTime('24:00'), false); });

import { occursOn, doneOn } from './index.ts';
test('weekly/monthly occurrence respects dates and skip', () => {
  const base = { date:'2026-10-18', created:'2026-10-18T01:00:00Z', startDate:'2026-10-18', endDate:'', skipDates:[], doneDates:[], status:'todo' };
  const weekly = { ...base, repeat:{ kind:'weekly', days:[7] } };
  assert.equal(occursOn(weekly,'2026-10-18'),true);
  assert.equal(occursOn(weekly,'2026-10-19'),false);
  assert.equal(occursOn({...weekly,skipDates:['2026-10-25']},'2026-10-25'),false);
  assert.equal(doneOn({...weekly,doneDates:['2026-10-18']},'2026-10-25'),false);
  const monthly = { ...base, repeat:{ kind:'monthly', days:[31] } };
  assert.equal(occursOn(monthly,'2026-10-31'),true);
  assert.equal(occursOn(monthly,'2026-11-30'),false);
  assert.equal(occursOn({...weekly,endDate:'2026-10-24'},'2026-10-25'),false);
});

import { dayTimeStats } from './index.ts';
test('overlapping entries differ from unique coverage', () => {
  const stats = dayTimeStats([{start:'09:00',minutes:60},{start:'09:30',minutes:60},{start:'12:00',minutes:0}]);
  assert.equal(stats.recordedMinutes,120);
  assert.equal(stats.coveredMinutes,90);
  assert.equal(stats.overlapMinutes,30);
});
