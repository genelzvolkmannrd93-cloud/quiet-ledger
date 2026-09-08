# Quiet Ledger: Gmail discovery implementation specification

Updated 2026-09-08. This is an implementation and verification contract. Gmail access is not currently enabled.

## Local implementation status

The separate `functions` package now contains disabled-by-deployment OAuth start, callback and disconnect handlers. It uses one-use hashed state, App Check on callable endpoints, recent-authentication enforcement for disconnect, Cloud KMS encryption and server-only Firestore collections. Pure security helpers have local unit coverage and the package compiles. No OAuth client, KMS key, cloud billing, live token exchange, Gmail message read, scheduled scan or production function deployment has been configured or verified.

## Product boundary

The feature may inspect a user's Gmail account only after a separate, explicit connection action. Its sole purpose is to find likely recurring-payment receipts and propose subscription records for the user to confirm. It must not create subscriptions silently, send mail, train models, build advertising profiles or expose message contents to the operator.

Ordinary Google sign-in remains independent and requests no Gmail permission. Declining or disconnecting Gmail must not prevent use of the manual tracker.

## Required Google scope

Receipt amounts, billing periods and renewal dates normally occur in the message body, so the intended production scope is `https://www.googleapis.com/auth/gmail.readonly`. Google currently classifies this as a restricted scope. A narrower metadata scope is insufficient for body-based extraction and must be reconsidered if the implemented feature can work without message bodies.

Do not add the production scope to authorization requests until the implemented flow and public verification materials are ready. Google requires production verification for restricted scopes, and server-side access to restricted data may require an independent recurring security assessment.

Authoritative references:

- <https://developers.google.com/workspace/gmail/api/auth/scopes>
- <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
- <https://support.google.com/cloud/answer/13464321?hl=en>

## Runtime architecture

All Gmail operations run in a trusted Google Cloud backend. No OAuth client secret, refresh token, access token, authorization code or raw message body may enter the Vite bundle, browser storage, client-readable Firestore paths, logs, analytics or Git history.

The backend requires a billing-enabled Google Cloud runtime; Firebase Spark alone is not sufficient for the planned server functions, Cloud KMS and scheduled work. Production and test OAuth clients must be separated. The production client uses only approved HTTPS redirect URIs on the verified domain.

Minimum components:

1. Firebase Authentication verifies the current user.
2. An HTTPS backend starts and completes the OAuth authorization-code flow.
3. Cloud KMS encrypts each refresh token before storage.
4. A server-only Firestore collection stores encrypted tokens and bounded scan state.
5. Gmail API requests use short-lived access tokens and narrow search queries.
6. Extracted proposals are stored under the user's own Firestore branch without raw message bodies.
7. Disconnect and account deletion revoke the Google grant and delete encrypted connection data.

## OAuth flow

### Start

`POST /gmail/connect/start`

- require and verify a Firebase ID token;
- require App Check for browser calls;
- apply per-UID and per-IP rate limits;
- generate a cryptographically random, one-use state value;
- store only a hash of state with UID, exact redirect URI and a short expiry;
- return a Google authorization URL for the single implemented Gmail scope;
- request offline access only because background discovery needs a refresh token.

### Callback

`GET /gmail/connect/callback`

- reject missing, expired, reused or UID-mismatched state;
- exchange the authorization code only on the backend;
- verify the granted scope is exactly sufficient before marking the connection active;
- encrypt the refresh token with Cloud KMS before persisting it;
- never log the code or token response;
- delete the state atomically and redirect to a fixed success/failure page;
- do not accept a caller-provided post-authentication redirect.

### Disconnect

`POST /gmail/disconnect`

- verify Firebase ID token, recent authentication and App Check;
- revoke the Google token/grant;
- delete encrypted token material and scan cursors;
- retain only a minimal audit event without email content or token data;
- succeed idempotently when already disconnected.

## Server-only data model

`gmailConnections/{uid}` is denied to all client SDK reads and writes. It contains only:

- encrypted refresh-token ciphertext and KMS key version;
- granted scope set;
- connection status and server timestamps;
- bounded Gmail history cursor;
- last successful scan time and non-sensitive error category.

It must not contain raw access tokens, authorization codes, card details, full message bodies or message attachments.

`users/{uid}/gmailProposals/{proposalId}` is readable and dismissible only by its owner. A proposal contains normalized merchant, amount in integer minor units, currency, cadence, candidate date, confidence, an opaque deduplication digest and server timestamps. It does not contain sender body text, subject text, message identifiers or snippets. Accepting a proposal still passes through the normal free-slot or paid-quota authority.

## Discovery and minimization

- Search a bounded recent window and advance through Gmail history rather than rescanning the whole mailbox.
- Use allowlisted receipt/billing signals and exclude obvious personal correspondence before fetching bodies.
- Fetch only the message parts needed for the parser; never fetch attachments for the initial feature.
- Parse in memory, retain only normalized proposal fields and discard body content immediately.
- Cap messages, bytes, execution time and proposals per run.
- Hash provider message identifiers with a server-held keyed digest for deduplication; do not expose the original identifier.
- Require user confirmation before creating or modifying any subscription.
- Show why a proposal was produced using normalized facts, not copied private text.

## Authorization invariants

- A Firebase UID can operate only its own Gmail connection and proposals.
- Client claims cannot grant Gmail or paid access.
- Service accounts receive only the IAM permissions needed for their function.
- The token-decrypting identity cannot deploy code or read unrelated Firestore data.
- Administrative support has no mailbox-reading path.
- App Check is defense in depth; Firebase authentication and server-side ownership checks remain mandatory.

## Deletion and incident response

Account deletion must call the trusted backend before deleting Firebase Authentication. The backend revokes Gmail access and deletes connection/proposal state, then the existing tombstone prevents browser sessions from recreating application data. If Google revocation is temporarily unavailable, deletion records a retryable server task without retaining raw message data and clearly reports that external revocation is pending.

Security logs contain event type, UID pseudonym, result and coarse error category only. Tokens, codes, query strings, message contents and personal email addresses are redacted. A suspected token exposure requires immediate OAuth client-secret rotation, token revocation, affected-user notification assessment and suspension of Gmail scans.

## Required tests before activation

- connection start rejects unauthenticated, missing-App-Check and rate-limited callers;
- state is random, expiring, one-use and bound to one UID and redirect URI;
- callback rejects forged/replayed state, scope downgrade and open redirects;
- token values never appear in logs, HTTP responses, client Firestore or built assets;
- KMS encrypt/decrypt permissions are exercised using separate service identities;
- two-user tests prove connection, proposal and deletion isolation;
- bounded scan tests cover oversized messages, malformed MIME, hostile HTML and parser timeouts;
- deduplication is idempotent under webhook/job retries and concurrent scans;
- proposal acceptance cannot bypass the three-slot free limit or future paid quota;
- disconnect and full account deletion revoke access and erase backend state;
- a live test account confirms Google consent, scan, disconnect and revocation;
- the repository security scan is repeated after implementation.

## External gates owned by the operator

- buy the chosen domain and verify ownership in Google Search Console;
- publish the homepage, privacy policy and terms on that domain;
- enable Google Cloud billing for the trusted backend and KMS;
- approve the exact OAuth consent-screen text and demonstration video;
- submit restricted-scope verification and complete any required security assessment;
- keep project contacts current and respond to Google verification requests.

No password, passport, INN, card number, OAuth secret or verification code should be sent through chat or committed to GitHub.
