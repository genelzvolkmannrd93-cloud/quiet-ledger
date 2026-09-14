import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticatedUid,
  createOauthState,
  gmailReadonlyScope,
  hashRateIdentity,
  hashOauthState,
  hasExactGmailScope,
  isRecentAuthentication,
  isStateFresh,
  safeResultUrl,
  verifiedIdentity,
} from '../src/security.ts';

test('OAuth state is high entropy, URL-safe and stored only as a digest', () => {
  const first = createOauthState();
  const second = createOauthState();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(hashOauthState(first).length, 64);
  assert.equal(hashOauthState(first), hashOauthState(first));
  assert.ok(!hashOauthState(first).includes(first));
});

test('Gmail grant must contain only the implemented restricted scope', () => {
  assert.equal(hasExactGmailScope(gmailReadonlyScope), true);
  assert.equal(hasExactGmailScope(undefined), false);
  assert.equal(hasExactGmailScope(`${gmailReadonlyScope} https://www.googleapis.com/auth/gmail.modify`), false);
  assert.equal(hasExactGmailScope('https://mail.google.com/'), false);
});

test('OAuth state and recent authentication use strict expiry boundaries', () => {
  const now = 2_000_000;
  assert.equal(isStateFresh(now + 1, now), true);
  assert.equal(isStateFresh(now, now), false);
  assert.equal(isRecentAuthentication((now - 299_999) / 1000, now), true);
  assert.equal(isRecentAuthentication((now - 300_001) / 1000, now), false);
  assert.equal(isRecentAuthentication((now + 1) / 1000, now), false);
});

test('result redirects are fixed to an HTTPS application origin', () => {
  assert.equal(safeResultUrl('https://quiet.example', 'connected'), 'https://quiet.example/?gmail=connected');
  assert.throws(() => safeResultUrl('http://quiet.example', 'error'));
  assert.throws(() => safeResultUrl('https://user:password@quiet.example', 'error'));
  assert.throws(() => safeResultUrl('https://quiet.example/path', 'error'));
  assert.throws(() => safeResultUrl('https://quiet.example/?next=https://evil.example', 'error'));
  assert.throws(() => safeResultUrl('https://quiet.example/#fragment', 'error'));
  assert.equal(safeResultUrl('http://127.0.0.1:5173', 'error'), 'http://127.0.0.1:5173/?gmail=error');
});

test('server identity admission fails closed for missing or unverified claims', () => {
  assert.equal(authenticatedUid(undefined), undefined);
  assert.equal(authenticatedUid({ uid: '' }), undefined);
  assert.equal(authenticatedUid({ uid: 'alice' }), 'alice');
  assert.equal(verifiedIdentity({ uid: 'alice', token: { email: 'a@example.com', email_verified: false } }), undefined);
  assert.equal(verifiedIdentity({ uid: 'alice', token: { email: 'a@example.com', email_verified: 'true' } }), undefined);
  assert.equal(verifiedIdentity({ uid: 'alice', token: { email_verified: true } }), undefined);
  assert.deepEqual(
    verifiedIdentity({ uid: 'alice', token: { email: ' Alice@Example.com ', email_verified: true } }),
    { uid: 'alice', email: 'alice@example.com' },
  );
});

test('rate-limit identities use a keyed digest and never retain the raw address', () => {
  const first = hashRateIdentity('203.0.113.8', 'test-secret-one');
  assert.equal(first.length, 64);
  assert.equal(first, hashRateIdentity('203.0.113.8', 'test-secret-one'));
  assert.notEqual(first, hashRateIdentity('203.0.113.8', 'test-secret-two'));
  assert.ok(!first.includes('203.0.113.8'));
  assert.throws(() => hashRateIdentity('', 'test-secret'));
  assert.throws(() => hashRateIdentity('203.0.113.8', ''));
});
