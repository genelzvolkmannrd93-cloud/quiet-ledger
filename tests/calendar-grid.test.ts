import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, shiftMonth } from '../src/calendar-grid.ts';

test('calendar grid starts on Monday and preserves leap-year dates', () => {
  const february = monthGrid('2028-02');
  assert.equal(february[0], null);
  assert.equal(february[1], '2028-02-01');
  assert.equal(february.filter(Boolean).length, 29);
  assert.ok(february.includes('2028-02-29'));
  assert.equal(february.length % 7, 0);
  assert.equal(monthGrid('2026-02').filter(Boolean).length, 28);
});

test('month navigation crosses year boundaries and rejects malformed input', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  for (const value of ['2026-00', '2026-13', 'not-a-date', '0000-01']) assert.throws(() => monthGrid(value));
  for (let month = 1; month <= 12; month++) {
    const key = `2026-${String(month).padStart(2, '0')}`;
    const dates = monthGrid(key).filter(Boolean);
    assert.equal(new Set(dates).size, dates.length);
    assert.ok(dates.every((date) => date!.startsWith(key)));
  }
});
