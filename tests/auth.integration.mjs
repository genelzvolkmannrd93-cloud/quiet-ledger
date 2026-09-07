import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') {
  throw new Error('Run only through the isolated Auth emulator on 127.0.0.1:9099');
}

let app;
let auth;
let registeredEmail;

before(() => {
  app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-quiet-ledger' }, 'auth-integration');
  auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
});

after(async () => {
  if (auth?.currentUser) await signOut(auth);
  if (app) await deleteApp(app);
});

test('email account starts unverified and accepts only its own password', async () => {
  const email = `person-${Date.now()}@example.com`;
  registeredEmail = email;
  const password = 'safe-password-123';
  const created = await createUserWithEmailAndPassword(auth, email, password);
  assert.equal(created.user.email, email);
  assert.equal(created.user.emailVerified, false);
  await signOut(auth);
  await assert.rejects(signInWithEmailAndPassword(auth, email, 'wrong-password'));
  const signedIn = await signInWithEmailAndPassword(auth, email, password);
  assert.equal(signedIn.user.uid, created.user.uid);
});

test('password-reset request is accepted for an email account', async () => {
  await sendPasswordResetEmail(auth, registeredEmail);
});

test('the signed-in user can delete the authentication account', async () => {
  await deleteUser(auth.currentUser);
  assert.equal(auth.currentUser, null);
  await assert.rejects(signInWithEmailAndPassword(auth, registeredEmail, 'safe-password-123'));
});
