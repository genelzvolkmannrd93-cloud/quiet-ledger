export type Identity = { uid: string; email: string | null; emailVerified: boolean };
export type AccessPolicy = { mode: 'private' | 'public'; ownerEmail: string; ownerUid: string };

export function isSameAccount(expected: { uid: string }, current: { uid: string } | null | undefined): boolean {
  return current?.uid === expected.uid;
}

// UI admission only. Database authorization is independently enforced by rules.
export function canEnter(user: Identity, policy: AccessPolicy): boolean {
  if (!user.emailVerified || !user.email) return false;
  if (policy.mode === 'public') return true;
  return user.email.toLowerCase() === policy.ownerEmail.trim().toLowerCase()
    && Boolean(policy.ownerUid) && user.uid === policy.ownerUid;
}
