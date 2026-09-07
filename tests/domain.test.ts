import assert from 'node:assert/strict';
import test from 'node:test';

import { monthlyAmount, validateInput, type SubscriptionInput } from '../src/domain.ts';

const validInput: SubscriptionInput = {
  name: 'Quiet service',
  amount: '349,50',
  currency: 'RUB',
  billingPeriod: 'monthly',
  nextBillingDate: '2026-09-10',
  category: 'software',
  status: 'active',
  notes: '  заметка  ',
};

test('normalizes safe subscription input', () => {
  const result = validateInput(validInput);

  assert.equal(result.amountCents, 34_950);
  assert.equal(result.notes, 'заметка');
});

test('rejects impossible calendar dates', () => {
  assert.throws(
    () => validateInput({ ...validInput, nextBillingDate: '2026-02-30' }),
    /корректную дату/,
  );
});

test('rejects amounts smaller than one kopeck', () => {
  assert.throws(
    () => validateInput({ ...validInput, amount: '0.001' }),
    /корректную сумму/,
  );
});

test('normalizes a yearly subscription to its native monthly amount', () => {
  const monthly = monthlyAmount({
    id: 'annual',
    name: 'Annual service',
    amountCents: 12_000,
    previousAmountCents: null,
    currency: 'USD',
    billingPeriod: 'yearly',
    nextBillingDate: '2026-09-10',
    category: 'software',
    status: 'active',
    notes: '',
  });

  assert.equal(monthly, 10);
});

test('money rejects silent rounding, exponents, hex and invalid boundaries', () => {
  for (const amount of ['0.005', '1.999', '1e3', '0x10', '-1', '0', '1000000.01', 'Infinity', '']) {
    assert.throws(() => validateInput({ ...validInput, amount }), /корректную сумму/);
  }
  for (const [amount, cents] of [['0.01', 1], ['1.10', 110], ['349,50', 34950], ['1000000', 100000000]]) {
    assert.equal(validateInput({ ...validInput, amount: String(amount) }).amountCents, cents);
  }
});
