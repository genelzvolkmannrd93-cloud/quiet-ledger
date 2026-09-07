import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, daysUntil, formatDate } from '../src/domain.ts';

test('displaying a date never moves it to a different calendar day', () => {
  const previousZone = process.env.TZ;
  try {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Moscow']) {
      process.env.TZ = zone;
      assert.equal(formatDate('2026-09-06'), '6 сентября 2026 г.');
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('dates follow the local calendar at midnight and year boundaries', () => {
  assert.equal(addDays(0, new Date(2026, 8, 6, 0, 15)), '2026-09-06');
  assert.equal(addDays(1, new Date(2026, 11, 31, 23, 45)), '2027-01-01');
  assert.equal(addDays(1, new Date(2028, 1, 28, 12)), '2028-02-29');
});

test('remaining days count calendar days including daylight saving changes', () => {
  assert.equal(daysUntil('2026-11-02', new Date(2026, 9, 31, 12)), 2);
  assert.equal(daysUntil('2026-09-06', new Date(2026, 8, 6, 23, 59)), 0);
  assert.equal(daysUntil('2026-09-05', new Date(2026, 8, 6)), -1);
});
