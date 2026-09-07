import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  runTransaction,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  defaultSettings,
  validateInput,
  type Subscription,
  type SubscriptionInput,
  type UserSettings,
} from './domain.ts';
import type { Backup } from './backup';

const freeSlots = ['free-1', 'free-2', 'free-3'] as const;
export const termsVersion = '2026-09-07';
const deletionStatePath = (database: Firestore, uid: string) => doc(database, 'accountDeletion', uid);

export async function restoreBackup(database: Firestore, uid: string, backup: Backup, plan: 'free' | 'paid' = 'paid') {
  if (plan === 'free') return restoreFreeBackup(database, uid, backup);
  return runTransaction(database, async (transaction) => {
    const refs = backup.subscriptions.map((item) => doc(database, 'users', uid, 'subscriptions', item.id));
    const settingsRef = doc(database, 'users', uid, 'private', 'settings');
    const [existing, settingsDocument] = await Promise.all([
      Promise.all(refs.map((ref) => transaction.get(ref))),
      transaction.get(settingsRef),
    ]);
    let added = 0;
    backup.subscriptions.forEach(({ id: _id, ...item }, index) => {
      if (existing[index].exists()) return;
      transaction.set(refs[index], { ...item, ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      added++;
    });
    if (settingsDocument.exists()) {
      transaction.update(settingsRef, { ...backup.settings, updatedAt: serverTimestamp() });
    } else {
      transaction.set(settingsRef, {
        ...backup.settings,
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return added;
  });
}

async function restoreFreeBackup(database: Firestore, uid: string, backup: Backup) {
  return runTransaction(database, async (transaction) => {
    const slotRefs = freeSlots.map((slot) => doc(database, 'users', uid, 'subscriptions', slot));
    const settingsRef = doc(database, 'users', uid, 'private', 'settings');
    const [slotDocuments, settingsDocument] = await Promise.all([
      Promise.all(slotRefs.map((ref) => transaction.get(ref))),
      transaction.get(settingsRef),
    ]);
    const occupied = new Set(slotDocuments.filter((snapshot) => snapshot.exists()).map((snapshot) => snapshot.id));
    const existingValues = slotDocuments.filter((snapshot) => snapshot.exists()).map((snapshot) => snapshot.data());
    const assignments: Array<{ slot: string; item: Backup['subscriptions'][number] }> = [];
    for (const item of backup.subscriptions) {
      if (existingValues.some((value) => sameSubscriptionValue(value, item))) continue;
      const preferred = freeSlots.includes(item.id as (typeof freeSlots)[number]) && !occupied.has(item.id as (typeof freeSlots)[number])
        ? item.id as (typeof freeSlots)[number]
        : undefined;
      const slot = preferred || freeSlots.find((candidate) => !occupied.has(candidate));
      if (!slot) throw new Error('На бесплатном тарифе можно хранить не более трёх подписок');
      occupied.add(slot);
      assignments.push({ slot, item });
    }
    assignments.forEach(({ slot, item: { id: _id, ...item } }) => {
      transaction.set(doc(database, 'users', uid, 'subscriptions', slot), {
        ...item,
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    if (settingsDocument.exists()) transaction.update(settingsRef, { ...backup.settings, updatedAt: serverTimestamp() });
    else transaction.set(settingsRef, { ...backup.settings, ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return assignments.length;
  });
}

function sameSubscriptionValue(value: Record<string, unknown>, item: Backup['subscriptions'][number]) {
  return value.name === item.name
    && value.amountCents === item.amountCents
    && value.previousAmountCents === item.previousAmountCents
    && value.currency === item.currency
    && value.billingPeriod === item.billingPeriod
    && value.nextBillingDate === item.nextBillingDate
    && value.category === item.category
    && value.status === item.status
    && value.notes === item.notes;
}

function subscriptionsPath(database: Firestore, uid: string) {
  return collection(database, 'users', uid, 'subscriptions');
}

export async function ensureOwnerDocuments(database: Firestore, user: { uid: string; email: string | null; displayName: string | null }) {
  const profileRef = doc(database, 'users', user.uid);
  const settingsRef = doc(database, 'users', user.uid, 'private', 'settings');
  await runTransaction(database, async (transaction) => {
    const [profile, settings] = await Promise.all([transaction.get(profileRef), transaction.get(settingsRef)]);
    const displayName = (user.displayName?.trim() || user.email?.split('@')[0] || 'Пользователь').slice(0, 80);
    if (!profile.exists()) {
      transaction.set(profileRef, {
        email: user.email,
        displayName,
        termsVersion,
        termsAcceptedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const current = profile.data();
      transaction.update(profileRef, {
        displayName,
        ...(!current.termsVersion || !current.termsAcceptedAt
          ? { termsVersion, termsAcceptedAt: serverTimestamp() }
          : {}),
        updatedAt: serverTimestamp(),
      });
    }
    if (!settings.exists()) {
      transaction.set(settingsRef, {
        ...defaultSettings,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export function watchSubscriptions(database: Firestore, uid: string, onValue: (items: Subscription[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(subscriptionsPath(database, uid), orderBy('nextBillingDate', 'asc'), limit(400)), (snapshot) => {
    onValue(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Subscription));
  }, onError);
}

export function watchSettings(database: Firestore, uid: string, onValue: (settings: UserSettings) => void, onError: (error: Error) => void): Unsubscribe {
  const unsubscribe = onSnapshot(doc(database, 'users', uid, 'private', 'settings'), (snapshot) => {
    if (snapshot.exists()) {
      const value = snapshot.data();
      onValue({
        baseCurrency: value.baseCurrency,
        reminderDays: value.reminderDays,
        notificationsEnabled: value.notificationsEnabled,
      });
      return;
    }
    onValue(defaultSettings);
  }, onError);
  return unsubscribe;
}

export async function createSubscription(database: Firestore, uid: string, input: SubscriptionInput, plan: 'free' | 'paid' = 'paid') {
  const value = validateInput(input);
  const record = {
    name: value.name,
    amountCents: value.amountCents,
    previousAmountCents: null,
    currency: value.currency,
    billingPeriod: value.billingPeriod,
    nextBillingDate: value.nextBillingDate,
    category: value.category,
    status: value.status,
    notes: value.notes,
    ownerId: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (plan === 'paid') {
    await addDoc(subscriptionsPath(database, uid), record);
    return;
  }
  await runTransaction(database, async (transaction) => {
    const refs = freeSlots.map((slot) => doc(database, 'users', uid, 'subscriptions', slot));
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const available = snapshots.findIndex((snapshot) => !snapshot.exists());
    if (available < 0) throw new Error('На бесплатном тарифе можно хранить не более трёх подписок');
    transaction.set(refs[available], record);
  });
}

export async function editSubscription(database: Firestore, uid: string, item: Subscription, input: SubscriptionInput) {
  const value = validateInput(input);
  await updateDoc(doc(database, 'users', uid, 'subscriptions', item.id), {
    name: value.name,
    amountCents: value.amountCents,
    previousAmountCents: value.amountCents === item.amountCents ? item.previousAmountCents : item.amountCents,
    currency: value.currency,
    billingPeriod: value.billingPeriod,
    nextBillingDate: value.nextBillingDate,
    category: value.category,
    status: value.status,
    notes: value.notes,
    updatedAt: serverTimestamp(),
  });
}

export async function toggleSubscription(database: Firestore, uid: string, item: Subscription) {
  await updateDoc(doc(database, 'users', uid, 'subscriptions', item.id), {
    status: item.status === 'active' ? 'paused' : 'active',
    updatedAt: serverTimestamp(),
  });
}

export async function removeSubscription(database: Firestore, uid: string, id: string) {
  await deleteDoc(doc(database, 'users', uid, 'subscriptions', id));
}

export async function deleteUserData(database: Firestore, uid: string) {
  await runTransaction(database, async (transaction) => {
    const stateRef = deletionStatePath(database, uid);
    const state = await transaction.get(stateRef);
    if (!state.exists()) transaction.set(stateRef, { ownerId: uid, createdAt: serverTimestamp() });
  });
  // Stay below Firestore's 500-write batch limit and keep deleting until the
  // collection is empty. The final batch removes the only private document and
  // the public profile; authentication itself remains managed by Firebase Auth.
  while (true) {
    const snapshot = await getDocs(query(subscriptionsPath(database, uid), limit(400)));
    if (snapshot.empty) break;
    const batch = writeBatch(database);
    snapshot.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  const batch = writeBatch(database);
  batch.delete(doc(database, 'users', uid, 'private', 'settings'));
  batch.delete(doc(database, 'users', uid));
  await batch.commit();
}

export async function updateSettings(database: Firestore, uid: string, settings: UserSettings) {
  const safeSettings: UserSettings = {
    baseCurrency: settings.baseCurrency,
    reminderDays: Math.max(0, Math.min(30, Math.round(settings.reminderDays))),
    notificationsEnabled: Boolean(settings.notificationsEnabled),
  };
  await updateDoc(doc(database, 'users', uid, 'private', 'settings'), {
    ...safeSettings,
    updatedAt: serverTimestamp(),
  });
}
