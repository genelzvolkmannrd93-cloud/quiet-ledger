import { createHash, createHmac, randomBytes } from 'node:crypto';

export const gmailReadonlyScope = 'https://www.googleapis.com/auth/gmail.readonly';
export const oauthStateLifetimeMs = 10 * 60 * 1000;
export const recentAuthenticationMs = 5 * 60 * 1000;

type AuthLike = {
  uid?: unknown;
  token?: {
    email?: unknown;
    email_verified?: unknown;
  };
} | null | undefined;

export function createOauthState() {
  return randomBytes(32).toString('base64url');
}

export function hashOauthState(state: string) {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

export function hashRateIdentity(value: string, secret: string) {
  if (!value || !secret) throw new Error('Rate-limit identity and secret are required');
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function authenticatedUid(auth: AuthLike) {
  return typeof auth?.uid === 'string' && auth.uid.length > 0 ? auth.uid : undefined;
}

export function verifiedIdentity(auth: AuthLike) {
  const uid = authenticatedUid(auth);
  const email = typeof auth?.token?.email === 'string' ? auth.token.email.trim().toLowerCase() : '';
  if (!uid || auth?.token?.email_verified !== true || !email) return undefined;
  return { uid, email };
}

export function hasExactGmailScope(scopeText: string | undefined) {
  if (!scopeText) return false;
  const scopes = new Set(scopeText.split(/\s+/).filter(Boolean));
  return scopes.size === 1 && scopes.has(gmailReadonlyScope);
}

export function isStateFresh(expiresAtMs: number, nowMs: number) {
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export function isRecentAuthentication(authTimeSeconds: unknown, nowMs: number) {
  return typeof authTimeSeconds === 'number'
    && authTimeSeconds * 1000 <= nowMs
    && nowMs - authTimeSeconds * 1000 <= recentAuthenticationMs;
}

export function safeResultUrl(appOrigin: string, result: 'connected' | 'error') {
  const originUrl = new URL(appOrigin);
  const isLocalDevelopment = originUrl.protocol === 'http:'
    && (originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost');
  if (originUrl.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('Gmail app origin must use HTTPS');
  }
  if (
    originUrl.username
    || originUrl.password
    || originUrl.pathname !== '/'
    || originUrl.search
    || originUrl.hash
  ) {
    throw new Error('Gmail app origin must be a bare origin');
  }
  const url = new URL('/', originUrl.origin);
  url.searchParams.set('gmail', result);
  return url.toString();
}
