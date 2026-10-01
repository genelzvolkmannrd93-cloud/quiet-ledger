import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as any },
  popup: vi.fn(), redirect: vi.fn(), result: vi.fn(), reload: vi.fn(),
}));
vi.mock('firebase/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class { setCustomParameters() {} },
  getAuth: () => mocks.auth,
  getRedirectResult: mocks.result,
  signInWithPopup: mocks.popup, signInWithRedirect: mocks.redirect,
  reload: mocks.reload, connectAuthEmulator: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(), deleteUser: vi.fn(), sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(), signInWithEmailAndPassword: vi.fn(), signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}), connectFirestoreEmulator: vi.fn() }));
vi.mock('firebase/app-check', () => ({ initializeAppCheck: vi.fn(), ReCaptchaEnterpriseProvider: class {} }));

beforeEach(() => {
  vi.resetModules();
  for (const fn of [mocks.popup, mocks.redirect, mocks.result, mocks.reload]) fn.mockReset();
  mocks.auth.currentUser = null;
  vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', '');
  for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
    vi.stubEnv(`VITE_FIREBASE_${key}`, 'test');
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test('protected local login stops with an actionable error when debug setup is missing', async () => {
  vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'test-key');
  const { signInWithGoogle } = await import('../src/firebase');
  await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'auth/local-app-check-required' });
  expect(mocks.popup).not.toHaveBeenCalled();
});

test('Google popup succeeds without starting a redirect', async () => {
  const { signInWithGoogle } = await import('../src/firebase');
  await signInWithGoogle();
  expect(mocks.popup).toHaveBeenCalledOnce();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
test('blocked popup falls back to redirect', async () => {
  mocks.popup.mockRejectedValue({ code: 'auth/popup-blocked' });
  const { signInWithGoogle } = await import('../src/firebase');
  await signInWithGoogle();
  expect(mocks.redirect).toHaveBeenCalledOnce();
});
test.each(['auth/cancelled-popup-request', 'auth/popup-closed-by-user', 'auth/internal-error'])('%s does not launch an unexpected redirect', async (code) => {
  mocks.popup.mockRejectedValue({ code });
  const { signInWithGoogle } = await import('../src/firebase');
  await expect(signInWithGoogle()).rejects.toEqual({ code });
  expect(mocks.redirect).not.toHaveBeenCalled();
});
test('explicit redirect bypasses popups', async () => {
  const { signInWithGoogle } = await import('../src/firebase');
  await signInWithGoogle('redirect');
  expect(mocks.popup).not.toHaveBeenCalled();
  expect(mocks.redirect).toHaveBeenCalledOnce();
});
test('redirect completion is consumed only once', async () => {
  mocks.result.mockResolvedValue(null);
  const { completeGoogleRedirect } = await import('../src/firebase');
  await Promise.all([completeGoogleRedirect(), completeGoogleRedirect()]);
  expect(mocks.result).toHaveBeenCalledOnce();
});
test('verification refresh cannot accept a different account after await', async () => {
  const token = vi.fn();
  mocks.auth.currentUser = { uid: 'first', emailVerified: true, getIdToken: token };
  mocks.reload.mockImplementation(async () => { mocks.auth.currentUser = { uid: 'second', emailVerified: true }; });
  const { refreshVerifiedUser } = await import('../src/firebase');
  expect(await refreshVerifiedUser()).toBe(false);
  expect(token).not.toHaveBeenCalled();
});
