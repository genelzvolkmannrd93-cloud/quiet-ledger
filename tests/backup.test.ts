import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBackup, serializeBackup } from '../src/backup.ts';
const record = { id: 'service1', name: 'Service', amountCents: 500, previousAmountCents: null,
  currency: 'RUB', billingPeriod: 'monthly', nextBillingDate: '2026-09-06', category: 'software', status: 'active', notes: '' };
const settings = { baseCurrency: 'RUB', reminderDays: 3, notificationsEnabled: true };

test('versioned export round trips without server or account metadata', () => {
  const clean = parseBackup(JSON.stringify({ subscriptions: [record], settings }));
  const withMetadata = { ...clean.subscriptions[0], ownerId: 'private-owner', createdAt: 'server-only' };
  const output = serializeBackup([withMetadata], clean.settings);
  assert.equal(JSON.parse(output).version, 1);
  assert.ok(!output.includes('private-owner'));
  assert.ok(!output.includes('server-only'));
  assert.deepEqual(parseBackup(output), clean);
});

test('import rejects unknown versions and checks actual UTF-8 byte size', () => {
  assert.throws(() => parseBackup(JSON.stringify({ version: 2, subscriptions: [], settings })), /версия/);
  const oversized = JSON.stringify({ subscriptions: [], settings, extra: 'я'.repeat(1_000_000) });
  assert.ok(oversized.length < 2_000_000);
  assert.throws(() => parseBackup(oversized), /слишком большой/);
});
test('backup sanitizes foreign ownership and server fields', () => {
  const result = parseBackup(JSON.stringify({ subscriptions: [{ ...record, ownerId: 'someone-else', createdAt: 'fake' }], settings }));
  assert.deepEqual(result.subscriptions, [record]);
});
test('backup rejects duplicate ids and paths', () => {
  assert.throws(() => parseBackup(JSON.stringify({ subscriptions: [record, record], settings })));
  assert.throws(() => parseBackup(JSON.stringify({ subscriptions: [{ ...record, id: '../other' }], settings })));
});
test('backup rejects corrupt dates, fractional cents and oversized collections', () => {
  for (const patch of [{ nextBillingDate: '2026-02-30' }, { amountCents: 0.5 }, { previousAmountCents: -1 }]) {
    assert.throws(() => parseBackup(JSON.stringify({ subscriptions: [{ ...record, ...patch }], settings })));
  }
  assert.throws(() => parseBackup(JSON.stringify({ subscriptions: Array(401).fill(record), settings })));
});
