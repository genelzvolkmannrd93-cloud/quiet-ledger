import assert from 'node:assert/strict';
import test from 'node:test';
import { nextOccurrence, upcomingOccurrences, type Subscription } from '../src/domain.ts';

const item: Subscription = { id: 'test', name: 'Service', amountCents: 100,
  previousAmountCents: null, currency: 'RUB', billingPeriod: 'monthly',
  nextBillingDate: '2024-01-31', category: 'software', status: 'active', notes: '' };

test('monthly recurrence retains its anchor after short months', () => {
  assert.equal(nextOccurrence(item, '2024-02-01'), '2024-02-29');
  assert.equal(nextOccurrence(item, '2024-03-01'), '2024-03-31');
  assert.equal(nextOccurrence(item, '2026-02-01'), '2026-02-28');
  assert.equal(item.nextBillingDate, '2024-01-31');
});
test('annual leap dates recover on the next leap year', () => {
  const annual = { ...item, billingPeriod: 'yearly' as const, nextBillingDate: '2024-02-29' };
  assert.equal(nextOccurrence(annual, '2025-01-01'), '2025-02-28');
  assert.equal(nextOccurrence(annual, '2028-01-01'), '2028-02-29');
});
test('today stays due and paused subscriptions do not advance', () => {
  assert.equal(nextOccurrence(item, '2024-01-31'), '2024-01-31');
  assert.equal(nextOccurrence({ ...item, status: 'paused' }, '2026-09-06'), '2024-01-31');
});

test('calendar forecasts every monthly charge for the next 12 months', () => {
  const dates = upcomingOccurrences(item, '2024-02-01').map((entry) => entry.nextBillingDate);
  assert.equal(dates.length, 12);
  assert.deepEqual(dates.slice(0, 3), ['2024-02-29', '2024-03-31', '2024-04-30']);
  assert.equal(dates.at(-1), '2025-01-31');
  assert.equal(item.nextBillingDate, '2024-01-31');
});

test('calendar forecasts annual charges and excludes paused subscriptions', () => {
  const annual = { ...item, billingPeriod: 'yearly' as const, nextBillingDate: '2024-02-29' };
  assert.deepEqual(upcomingOccurrences(annual, '2025-03-01').map((entry) => entry.nextBillingDate), ['2026-02-28']);
  assert.deepEqual(upcomingOccurrences({ ...item, status: 'paused' }, '2025-03-01'), []);
});
