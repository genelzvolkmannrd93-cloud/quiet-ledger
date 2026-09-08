import { before, after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createSubscription, deleteUserData, restoreBackup, ensureOwnerDocuments, termsVersion } from '../src/data.ts';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, limit, query, serverTimestamp, writeBatch } from 'firebase/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Run only through the isolated Firestore emulator on 127.0.0.1:8080');
}
const owner = 'demo-owner';
const email = 'owner@example.com';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-quiet-ledger', firestore: {
    host: '127.0.0.1', port: 8080, rules: await readFile('.generated/firestore.private.rules', 'utf8'),
  } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });
const database = (uid = owner, claims = { email, email_verified: true }) => env.authenticatedContext(uid, claims).firestore();
const ref = (db, uid = owner) => doc(db, 'users', uid, 'subscriptions', 'sample');
const record = () => ({ name: 'Service', amountCents: 500, previousAmountCents: null,
  currency: 'RUB', billingPeriod: 'monthly', nextBillingDate: '2026-09-06', category: 'software',
  status: 'active', notes: '', ownerId: owner, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const settings = { baseCurrency: 'EUR', reminderDays: 7, notificationsEnabled: false };
const backup = (subscriptions) => ({ subscriptions, settings });
const input = (name) => ({ name, amount: '5', currency: 'RUB', billingPeriod: 'monthly',
  nextBillingDate: '2026-09-06', category: 'software', status: 'active', notes: '' });

test('verified owner can create, read, update and delete a subscription', async () => {
  const target = ref(database());
  await assertSucceeds(setDoc(target, record()));
  await assertSucceeds(getDoc(target));
  await assertSucceeds(updateDoc(target, { status: 'paused', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(target));
});

test('anonymous and foreign accounts cannot access owner subscriptions', async () => {
  await setDoc(ref(database()), record());
  for (const db of [env.unauthenticatedContext().firestore(), database('other')]) {
    await assertFails(getDoc(ref(db)));
    await assertFails(setDoc(ref(db), record()));
    await assertFails(deleteDoc(ref(db)));
  }
});

test('unverified or wrong-email owner claims are rejected', async () => {
  for (const claims of [{ email, email_verified: false }, { email: 'other@example.com', email_verified: true }]) {
    await assertFails(setDoc(ref(database(owner, claims)), record()));
  }
});

test('owner cannot write into another account or forge ownership', async () => {
  const db = database();
  await assertFails(setDoc(ref(db, 'other'), record()));
  await assertFails(setDoc(ref(db), { ...record(), ownerId: 'other' }));
});

test('schema blocks privileged fields, invalid money and timestamp forgery', async () => {
  for (const patch of [{ role: 'admin' }, { amountCents: -1 }, { amountCents: 1.5 }, { createdAt: new Date(0) }]) {
    await assertFails(setDoc(ref(database()), { ...record(), ...patch }));
  }
});

test('backup restore is repeatable and preserves existing records', async () => {
  const db = database();
  const { ownerId, createdAt, updatedAt, ...subscription } = record();
  const copy = backup([{ ...subscription, id: 'sample' }]);
  assert.equal(await restoreBackup(db, owner, copy), 1);
  const restoredSettings = (await getDoc(doc(db, 'users', owner, 'private', 'settings'))).data();
  assert.equal(restoredSettings.baseCurrency, settings.baseCurrency);
  assert.equal(restoredSettings.reminderDays, settings.reminderDays);
  assert.equal(restoredSettings.notificationsEnabled, settings.notificationsEnabled);
  assert.equal(restoredSettings.ownerId, owner);
  assert.ok(restoredSettings.createdAt);
  assert.ok(restoredSettings.updatedAt);
  await updateDoc(ref(db), { name: 'Edited service', updatedAt: serverTimestamp() });
  await updateDoc(doc(db, 'users', owner, 'private', 'settings'), { reminderDays: 2, updatedAt: serverTimestamp() });
  assert.equal(await restoreBackup(db, owner, copy), 0);
  assert.equal((await getDoc(ref(db))).data().name, 'Edited service');
  assert.equal((await getDoc(doc(db, 'users', owner, 'private', 'settings'))).data().reminderDays, 7);
  assert.equal(await restoreBackup(db, owner, backup([])), 0);
  await assertFails(restoreBackup(database('other'), owner, copy));
});

test('concurrent first login preserves a valid profile and initializes settings once', async () => {
  const user = { uid: owner, email, displayName: 'Owner' };
  await Promise.all([ensureOwnerDocuments(database(), user), ensureOwnerDocuments(database(), user)]);
  const profile = await getDoc(doc(database(), 'users', owner));
  const initializedSettings = await getDoc(doc(database(), 'users', owner, 'private', 'settings'));
  assert.equal(profile.data().displayName, 'Owner');
  assert.equal(profile.data().email, email);
  assert.equal(profile.data().termsVersion, termsVersion);
  assert.ok(profile.data().termsAcceptedAt);
  assert.equal(initializedSettings.data().ownerId, owner);
  assert.equal(initializedSettings.data().baseCurrency, 'RUB');
});

test('legacy profile receives one immutable consent record', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', owner), {
      email, displayName: 'Legacy owner', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
  const db = database();
  await ensureOwnerDocuments(db, { uid: owner, email, displayName: 'Owner' });
  const profileRef = doc(db, 'users', owner);
  const profile = await getDoc(profileRef);
  assert.equal(profile.data().termsVersion, termsVersion);
  assert.ok(profile.data().termsAcceptedAt);
  await assertFails(updateDoc(profileRef, {
    termsAcceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('maximum 400-record backup restores completely and remains repeatable', async () => {
  const db = database();
  const { ownerId, createdAt, updatedAt, ...subscription } = record();
  const copy = backup(Array.from({ length: 400 }, (_, index) => ({ ...subscription, id: `item-${index}` })));
  assert.equal(await restoreBackup(db, owner, copy), 400);
  assert.equal((await getDocs(collection(db, 'users', owner, 'subscriptions'))).size, 400);
  assert.equal(await restoreBackup(db, owner, copy), 0);
});

test('simultaneous restores do not duplicate or overwrite records', async () => {
  const { ownerId, createdAt, updatedAt, ...subscription } = record();
  const copy = backup(Array.from({ length: 10 }, (_, index) => ({ ...subscription, id: `item-${index}` })));
  const counts = await Promise.all([restoreBackup(database(), owner, copy), restoreBackup(database(), owner, copy)]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 10);
  assert.equal((await getDocs(collection(database(), 'users', owner, 'subscriptions'))).size, 10);
});

test('invalid import fails atomically without saving its valid records', async () => {
  const { ownerId, createdAt, updatedAt, ...subscription } = record();
  const copy = backup([{ ...subscription, id: 'valid' }, { ...subscription, id: 'invalid', amountCents: -1 }]);
  await assertFails(restoreBackup(database(), owner, copy));
  assert.equal((await getDocs(collection(database(), 'users', owner, 'subscriptions'))).size, 0);
  assert.equal((await getDoc(doc(database(), 'users', owner, 'private', 'settings'))).exists(), false);
});

test('public candidate permits independent accounts but rejects cross-account access', async () => {
  await env.cleanup();
  env = await initializeTestEnvironment({ projectId: 'demo-quiet-ledger', firestore: {
    host: '127.0.0.1', port: 8080, rules: await readFile('firestore.public.rules', 'utf8'),
  } });
  const publicRef = (db, uid) => doc(db, 'users', uid, 'subscriptions', 'free-1');
  const alice = database('alice', { email: 'alice@example.com', email_verified: true, plan: 'paid' });
  const bob = database('bob', { email: 'bob@example.com', email_verified: true, plan: 'paid' });
  for (const [uid, db] of [['alice', alice], ['bob', bob]]) {
    await assertSucceeds(setDoc(doc(db, 'users', uid), {
      email: `${uid}@example.com`, displayName: uid, termsVersion, termsAcceptedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(db, 'users', uid, 'private', 'settings'), {
      ...settings, ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(publicRef(db, uid), { ...record(), ownerId: uid }));
    await assertSucceeds(getDoc(doc(db, 'users', uid)));
    await assertSucceeds(getDoc(doc(db, 'users', uid, 'private', 'settings')));
    await assertSucceeds(getDoc(publicRef(db, uid)));
    await assertSucceeds(updateDoc(publicRef(db, uid), { status: 'paused', updatedAt: serverTimestamp() }));
  }
  for (const [other, db] of [['bob', alice], ['alice', bob]]) {
    await assertFails(getDoc(doc(db, 'users', other)));
    await assertFails(getDoc(doc(db, 'users', other, 'private', 'settings')));
    await assertFails(getDoc(publicRef(db, other)));
    await assertFails(updateDoc(publicRef(db, other), { name: 'Hijacked', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(publicRef(db, other)));
  }
  await assertFails(getDocs(collection(alice, 'users')));
  await assertFails(updateDoc(doc(alice, 'users', 'alice'), { email: 'bob@example.com', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'users', 'alice'), { termsAcceptedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'users', 'alice', 'private', 'settings'), { ownerId: 'bob', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'private', 'tokens'), {
    ownerId: 'alice', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(alice, 'gmailConnections', 'alice')));
  await assertFails(setDoc(doc(alice, 'gmailConnections', 'alice'), { status: 'connected' }));
  await assertFails(setDoc(doc(alice, 'gmailOauthStates', 'forged-state'), { uid: 'alice' }));
  await assertFails(setDoc(doc(alice, 'gmailRateLimits', 'alice'), { count: 0 }));
  await assertFails(setDoc(publicRef(alice, 'alice'), { ...record(), ownerId: 'bob' }));
  const unverified = database('charlie', { email: 'charlie@example.com', email_verified: false });
  await assertFails(setDoc(doc(unverified, 'users', 'charlie'), {
    email: 'charlie@example.com', displayName: 'Charlie', termsVersion, termsAcceptedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(publicRef(unverified, 'charlie'), { ...record(), ownerId: 'charlie' }));
  const noConsent = database('no-consent', { email: 'no-consent@example.com', email_verified: true });
  await assertFails(setDoc(doc(noConsent, 'users', 'no-consent'), {
    email: 'no-consent@example.com', displayName: 'No consent', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(publicRef(env.unauthenticatedContext().firestore(), 'alice')));
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    const batch = writeBatch(admin);
    for (let index = 0; index < 401; index++) {
      batch.set(doc(admin, 'users', 'alice', 'subscriptions', `bulk-${index}`), { ...record(), ownerId: 'alice' });
    }
    await batch.commit();
  });
  await assertSucceeds(deleteUserData(alice, 'alice'));
  assert.equal((await getDocs(query(collection(alice, 'users', 'alice', 'subscriptions'), limit(400)))).size, 0);
  assert.equal((await getDoc(doc(alice, 'users', 'alice', 'private', 'settings'))).exists(), false);
  assert.equal((await getDoc(doc(alice, 'users', 'alice'))).exists(), false);
  assert.equal((await getDoc(doc(alice, 'accountDeletion', 'alice'))).exists(), true);
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'subscriptions', 'free-1'), { ...record(), ownerId: 'alice' }));
  await assertFails(setDoc(doc(alice, 'users', 'alice'), {
    email: 'alice@example.com', displayName: 'Recreated', termsVersion, termsAcceptedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'private', 'settings'), {
    ...settings, ownerId: 'alice', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(alice, 'accountDeletion', 'alice')));
  await assertSucceeds(getDoc(publicRef(bob, 'bob')));
});

test('public launch is capped at three server-enforced slots and paid claims cannot bypass the cap', async () => {
  const free = database('free', { email: 'free@example.com', email_verified: true });
  await ensureOwnerDocuments(free, { uid: 'free', email: 'free@example.com', displayName: 'Free' });
  await createSubscription(free, 'free', input('One'), 'free');
  await createSubscription(free, 'free', input('Two'), 'free');
  await createSubscription(free, 'free', input('Three'), 'free');
  await assertFails(getDocs(collection(free, 'users', 'free', 'subscriptions')));
  assert.equal((await getDocs(query(collection(free, 'users', 'free', 'subscriptions'), limit(400)))).size, 3);
  await assert.rejects(createSubscription(free, 'free', input('Four'), 'free'), /не более трёх/);
  await assertFails(setDoc(doc(free, 'users', 'free', 'subscriptions', 'free-4'), { ...record(), ownerId: 'free' }));
  await assertFails(setDoc(doc(free, 'users', 'free', 'subscriptions', 'forged-paid'), { ...record(), ownerId: 'free' }));
  await assertFails(updateDoc(doc(free, 'users', 'free'), { plan: 'paid', updatedAt: serverTimestamp() }));

  await deleteDoc(doc(free, 'users', 'free', 'subscriptions', 'free-2'));
  await createSubscription(free, 'free', input('Replacement'), 'free');
  assert.equal((await getDocs(query(collection(free, 'users', 'free', 'subscriptions'), limit(400)))).size, 3);

  const restoreUser = database('restore-free', { email: 'restore@example.com', email_verified: true });
  const { ownerId, createdAt, updatedAt, ...subscription } = record();
  const tooLarge = backup(Array.from({ length: 4 }, (_, index) => ({ ...subscription, id: `legacy-${index}` })));
  await assert.rejects(restoreBackup(restoreUser, 'restore-free', tooLarge, 'free'), /не более трёх/);
  assert.equal((await getDocs(query(collection(restoreUser, 'users', 'restore-free', 'subscriptions'), limit(400)))).size, 0);
  assert.equal((await getDoc(doc(restoreUser, 'users', 'restore-free', 'private', 'settings'))).exists(), false);
  const fitting = backup(tooLarge.subscriptions.slice(0, 3));
  assert.equal(await restoreBackup(restoreUser, 'restore-free', fitting, 'free'), 3);
  assert.equal(await restoreBackup(restoreUser, 'restore-free', fitting, 'free'), 0);
  assert.equal((await getDocs(query(collection(restoreUser, 'users', 'restore-free', 'subscriptions'), limit(400)))).size, 3);

  const collisionUser = database('collision-free', { email: 'collision@example.com', email_verified: true });
  await ensureOwnerDocuments(collisionUser, { uid: 'collision-free', email: 'collision@example.com', displayName: 'Collision' });
  await createSubscription(collisionUser, 'collision-free', input('Existing slot'), 'free');
  const colliding = backup([{ ...subscription, id: 'free-1', name: 'Imported into free slot' }]);
  assert.equal(await restoreBackup(collisionUser, 'collision-free', colliding, 'free'), 1);
  assert.equal(await restoreBackup(collisionUser, 'collision-free', colliding, 'free'), 0);
  const collisionNames = (await getDocs(query(collection(collisionUser, 'users', 'collision-free', 'subscriptions'), limit(400)))).docs.map((item) => item.data().name).sort();
  assert.deepEqual(collisionNames, ['Existing slot', 'Imported into free slot']);

  const paid = database('paid', { email: 'paid@example.com', email_verified: true, plan: 'paid' });
  await assertFails(setDoc(doc(paid, 'users', 'paid', 'subscriptions', 'unlimited-id'), { ...record(), ownerId: 'paid' }));
  await assertSucceeds(setDoc(doc(paid, 'users', 'paid', 'subscriptions', 'free-1'), { ...record(), ownerId: 'paid' }));

  const paidImport = database('paid-import', { email: 'paid-import@example.com', email_verified: true, plan: 'paid' });
  const paidBypass = backup([{ ...subscription, id: 'unlimited-import-id' }]);
  await assertFails(restoreBackup(paidImport, 'paid-import', paidBypass, 'paid'));
  assert.equal((await getDocs(query(collection(paidImport, 'users', 'paid-import', 'subscriptions'), limit(400)))).size, 0);
  assert.equal((await getDoc(doc(paidImport, 'users', 'paid-import', 'private', 'settings'))).exists(), false);

  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'legacy', 'subscriptions', 'paid-era'), { ...record(), ownerId: 'legacy' });
  });
  const downgraded = database('legacy', { email: 'legacy@example.com', email_verified: true });
  const legacyRef = doc(downgraded, 'users', 'legacy', 'subscriptions', 'paid-era');
  await assertSucceeds(getDoc(legacyRef));
  await assertFails(updateDoc(legacyRef, { name: 'Repurposed', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(legacyRef));
});
