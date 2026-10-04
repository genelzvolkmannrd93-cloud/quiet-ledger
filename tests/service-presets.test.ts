import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyServicePreset, serviceBadge, servicePresets } from '../src/service-presets.ts';
import { categories, type SubscriptionInput } from '../src/domain.ts';

test('suggestions preserve the user price, currency, recurrence, date and notes', () => {
  const form: SubscriptionInput = { name: 'Custom', amount: '721.50', currency: 'RUB', billingPeriod: 'yearly', nextBillingDate: '2026-10-31', category: 'other', status: 'paused', notes: 'Personal price' };
  assert.deepEqual(applyServicePreset(form, servicePresets[0]), { ...form, name: 'Spotify', category: 'entertainment' });
  assert.equal(form.name, 'Custom');
});

test('local badges match exact names only and suggestions have valid categories', () => {
  assert.equal(serviceBadge(' spotify ')?.mark, 'S');
  assert.equal(serviceBadge('Spotify phishing'), undefined);
  assert.equal(new Set(servicePresets.map((p) => p.name)).size, servicePresets.length);
  assert.ok(servicePresets.every((p) => categories.includes(p.category)));
});
