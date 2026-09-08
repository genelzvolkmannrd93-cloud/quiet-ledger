import { KeyManagementServiceClient } from '@google-cloud/kms';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { google } from 'googleapis';
import {
  createOauthState,
  gmailReadonlyScope,
  hashOauthState,
  hasExactGmailScope,
  isRecentAuthentication,
  isStateFresh,
  oauthStateLifetimeMs,
  safeResultUrl,
} from './security.js';

initializeApp();

const firestore = getFirestore();
const kms = new KeyManagementServiceClient();
const oauthClientSecret = defineSecret('GMAIL_OAUTH_CLIENT_SECRET');
const oauthClientId = defineString('GMAIL_OAUTH_CLIENT_ID');
const oauthRedirectUri = defineString('GMAIL_OAUTH_REDIRECT_URI');
const gmailAppOrigin = defineString('GMAIL_APP_ORIGIN');
const gmailKmsKeyName = defineString('GMAIL_KMS_KEY_NAME');

const stateCollection = 'gmailOauthStates';
const connectionCollection = 'gmailConnections';
const rateCollection = 'gmailRateLimits';
const rateWindowMs = 60_000;
const rateLimit = 5;

function oauthClient() {
  return new google.auth.OAuth2(
    oauthClientId.value(),
    oauthClientSecret.value(),
    oauthRedirectUri.value(),
  );
}

function queryValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

async function consumeState(rawState: string) {
  const ref = firestore.collection(stateCollection).doc(hashOauthState(rawState));
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('invalid_state');
    const data = snapshot.data();
    const uid = data?.uid;
    const expiresAt = data?.expiresAt;
    const redirectUri = data?.redirectUri;
    if (typeof uid !== 'string'
      || !(expiresAt instanceof Timestamp)
      || redirectUri !== oauthRedirectUri.value()
      || !isStateFresh(expiresAt.toMillis(), Date.now())) {
      transaction.delete(ref);
      throw new Error('invalid_state');
    }
    transaction.delete(ref);
    return uid;
  });
}

async function encryptRefreshToken(refreshToken: string) {
  const keyName = gmailKmsKeyName.value();
  const [result] = await kms.encrypt({ name: keyName, plaintext: Buffer.from(refreshToken, 'utf8') });
  if (!result.ciphertext) throw new Error('token_encryption_failed');
  return Buffer.from(result.ciphertext).toString('base64');
}

async function decryptRefreshToken(ciphertext: string) {
  const [result] = await kms.decrypt({
    name: gmailKmsKeyName.value(),
    ciphertext: Buffer.from(ciphertext, 'base64'),
  });
  if (!result.plaintext) throw new Error('token_decryption_failed');
  return Buffer.from(result.plaintext).toString('utf8');
}

export const gmailConnectStart = onCall({
  enforceAppCheck: true,
  consumeAppCheckToken: true,
  secrets: [oauthClientSecret],
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Требуется вход в аккаунт.');

  const now = Date.now();
  const state = createOauthState();
  const stateRef = firestore.collection(stateCollection).doc(hashOauthState(state));
  const rateRef = firestore.collection(rateCollection).doc(uid);
  const connectionRef = firestore.collection(connectionCollection).doc(uid);

  await firestore.runTransaction(async (transaction) => {
    const [rateSnapshot, connectionSnapshot] = await Promise.all([
      transaction.get(rateRef),
      transaction.get(connectionRef),
    ]);
    if (connectionSnapshot.exists) {
      throw new HttpsError('already-exists', 'Gmail уже подключён или ожидает отключения.');
    }
    const rateData = rateSnapshot.data();
    const windowStartedAt = rateData?.windowStartedAt;
    const inWindow = windowStartedAt instanceof Timestamp
      && now - windowStartedAt.toMillis() < rateWindowMs;
    const count = inWindow && typeof rateData?.count === 'number' ? rateData.count : 0;
    if (count >= rateLimit) throw new HttpsError('resource-exhausted', 'Слишком много попыток подключения.');

    transaction.set(rateRef, {
      count: count + 1,
      windowStartedAt: inWindow ? windowStartedAt : Timestamp.fromMillis(now),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(stateRef, {
      uid,
      redirectUri: oauthRedirectUri.value(),
      expiresAt: Timestamp.fromMillis(now + oauthStateLifetimeMs),
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  const authorizationUrl = oauthClient().generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: false,
    prompt: 'consent',
    scope: [gmailReadonlyScope],
    state,
  });
  return { authorizationUrl };
});

export const gmailConnectCallback = onRequest({ secrets: [oauthClientSecret] }, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.set('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET') {
    response.status(405).send('Method not allowed');
    return;
  }

  const connectedResultUrl = safeResultUrl(gmailAppOrigin.value(), 'connected');
  const errorResultUrl = safeResultUrl(gmailAppOrigin.value(), 'error');
  let connectionUid: string | undefined;
  let exchangedRefreshToken: string | undefined;
  let encryptedRefreshToken: string | undefined;
  try {
    const state = queryValue(request.query.state);
    if (!state) throw new Error('invalid_state');
    connectionUid = await consumeState(state);
    if (queryValue(request.query.error)) throw new Error('authorization_declined');
    const code = queryValue(request.query.code);
    if (!code) throw new Error('missing_code');

    const client = oauthClient();
    const tokenResponse = await client.getToken(code);
    const tokens = tokenResponse.tokens;
    exchangedRefreshToken = tokens.refresh_token ?? undefined;
    if (!exchangedRefreshToken || !tokens.access_token) throw new Error('missing_token');

    const tokenInfo = await client.getTokenInfo(tokens.access_token);
    const grantedScope = tokenInfo.scopes.join(' ');
    if (!hasExactGmailScope(grantedScope)) {
      await client.revokeToken(exchangedRefreshToken);
      exchangedRefreshToken = undefined;
      throw new Error('unexpected_scope');
    }

    encryptedRefreshToken = await encryptRefreshToken(exchangedRefreshToken);
    await firestore.collection(connectionCollection).doc(connectionUid).create({
      status: 'connected',
      scope: [gmailReadonlyScope],
      tokenCiphertext: encryptedRefreshToken,
      kmsKeyName: gmailKmsKeyName.value(),
      connectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    exchangedRefreshToken = undefined;
    response.redirect(303, connectedResultUrl);
  } catch {
    if (exchangedRefreshToken) {
      try {
        await oauthClient().revokeToken(exchangedRefreshToken);
      } catch {
        if (connectionUid && encryptedRefreshToken) {
          try {
            await firestore.collection('gmailRevocationJobs').add({
              uid: connectionUid,
              status: 'pending',
              tokenCiphertext: encryptedRefreshToken,
              kmsKeyName: gmailKmsKeyName.value(),
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          } catch {
            // Token and storage failures are never logged because they may contain sensitive context.
          }
        }
      }
    }
    response.redirect(303, errorResultUrl);
  }
});

export const gmailDisconnect = onCall({
  enforceAppCheck: true,
  consumeAppCheckToken: true,
  secrets: [oauthClientSecret],
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Требуется вход в аккаунт.');
  if (!isRecentAuthentication(request.auth?.token.auth_time, Date.now())) {
    throw new HttpsError('failed-precondition', 'Для отключения Gmail войдите заново.');
  }

  const ref = firestore.collection(connectionCollection).doc(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { status: 'disconnected' };
  const ciphertext = snapshot.data()?.tokenCiphertext;
  if (typeof ciphertext !== 'string') {
    await ref.update({ status: 'disconnect_pending', updatedAt: FieldValue.serverTimestamp() });
    return { status: 'disconnect_pending' };
  }

  try {
    const refreshToken = await decryptRefreshToken(ciphertext);
    await oauthClient().revokeToken(refreshToken);
    await ref.delete();
    return { status: 'disconnected' };
  } catch {
    await ref.update({ status: 'disconnect_pending', updatedAt: FieldValue.serverTimestamp() });
    return { status: 'disconnect_pending' };
  }
});
