import assert from 'node:assert/strict';
import test from 'node:test';
import { canEnter, isSameAccount } from '../src/access.ts';

const owner = { uid: 'owner', email: 'owner@example.com', emailVerified: true };
const policy = { mode: 'private' as const, ownerEmail: owner.email, ownerUid: owner.uid };

test('private admission requires exact UID and verified owner email, failing closed', () => {
  assert.equal(canEnter(owner, policy), true);
  assert.equal(canEnter({ ...owner, uid: 'other' }, policy), false);
  assert.equal(canEnter({ ...owner, emailVerified: false }, policy), false);
  assert.equal(canEnter(owner, { ...policy, ownerUid: '' }), false);
});

test('public admission permits verified accounts but not anonymous or unverified identities', () => {
  const publicPolicy = { ...policy, mode: 'public' as const };
  assert.equal(canEnter({ uid: 'other', email: 'other@example.com', emailVerified: true }, publicPolicy), true);
  assert.equal(canEnter({ ...owner, email: null }, publicPolicy), false);
  assert.equal(canEnter({ ...owner, emailVerified: false }, publicPolicy), false);
});

test('destructive account actions stay bound to the originally confirmed UID', () => {
  assert.equal(isSameAccount({ uid: 'alice' }, { uid: 'alice' }), true);
  assert.equal(isSameAccount({ uid: 'alice' }, { uid: 'bob' }), false);
  assert.equal(isSameAccount({ uid: 'alice' }, null), false);
});
