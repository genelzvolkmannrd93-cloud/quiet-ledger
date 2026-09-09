import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { canEnter, isSameAccount } from './access';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  connectAuthEmulator,
  getAuth,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

export type UserPlan = 'free' | 'paid';

const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';
export const publicAccess = import.meta.env.VITE_ACCESS_MODE === 'public';
export const paidFeaturesEnabled = publicAccess && import.meta.env.VITE_PAID_FEATURES_ENABLED === 'true';
const firebaseConfig = useEmulators ? {
  apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-quiet-ledger',
  storageBucket: 'demo-quiet-ledger.appspot.com', messagingSenderId: '123456789', appId: 'demo-quiet-ledger',
} : {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const ownerEmail = publicAccess ? '' : (import.meta.env.VITE_OWNER_EMAIL || '').trim().toLowerCase();
export const ownerUid = publicAccess ? '' : (import.meta.env.VITE_OWNER_UID || '').trim();
export const supportEmail = (import.meta.env.VITE_SUPPORT_EMAIL || '').trim().toLowerCase();
export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);

let app: FirebaseApp | null = null;
export let auth: Auth | null = null;
export let db: Firestore | null = null;

if (firebaseConfigured) {
  app = getApps()[0] ?? initializeApp(firebaseConfig);
  const appCheckKey = (import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || '').trim();
  if (!useEmulators && appCheckKey && window.location.hostname !== 'localhost') {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  // App Check is activated before any protected Firebase service is created.
  auth = getAuth(app);
  db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099');
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function isAllowedOwner(user: User) {
  return canEnter(user, { mode: publicAccess ? 'public' : 'private', ownerEmail, ownerUid });
}

export async function getUserPlan(user: User): Promise<UserPlan> {
  if (!paidFeaturesEnabled) return 'free';
  const token = await user.getIdTokenResult();
  return token.claims.plan === 'paid' ? 'paid' : 'free';
}

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase ещё не подключён');
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    throw error;
  }
}

export async function signInWithEmail(email: string, password: string) {
  if (!auth) throw new Error('Firebase ещё не подключён');
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerWithEmail(email: string, password: string) {
  if (!auth) throw new Error('Firebase ещё не подключён');
  if (password.length < 8) throw new Error('Пароль должен содержать не менее 8 символов');
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(credential.user);
}

export async function requestPasswordReset(email: string) {
  if (!auth) throw new Error('Firebase ещё не подключён');
  await sendPasswordResetEmail(auth, email.trim());
}

export async function sendVerificationEmail() {
  if (!auth?.currentUser) throw new Error('Сначала войдите в аккаунт');
  await sendEmailVerification(auth.currentUser);
}

export async function refreshVerifiedUser() {
  if (!auth?.currentUser) return false;
  await reload(auth.currentUser);
  if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
  return auth.currentUser.emailVerified;
}

export async function leaveAccount() {
  if (auth) await signOut(auth);
}

export async function deleteCurrentAccount(expectedUser: User) {
  if (!auth?.currentUser) throw new Error('Сначала войдите в аккаунт');
  if (!isSameAccount(expectedUser, auth.currentUser)) {
    throw Object.assign(new Error('Аккаунт изменился. Удаление остановлено.'), { code: 'auth/account-changed' });
  }
  await deleteUser(expectedUser);
}
