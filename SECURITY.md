# Security Policy

## System and Scope

Quiet Ledger is a React/Vite application backed by Firebase Authentication,
Firestore, Hosting and App Check. This policy covers application source,
Firebase rules, deployment configuration, tests and future payment/email backends.

## Threat Model and Trust Boundaries

User input, URL parameters, Firestore documents, payment
notifications and future email contents are untrusted. Firebase ID tokens are
trusted only after server-side verification. Payment and OAuth secrets must
exist only in protected server storage.

## Security Invariants

- Every user can read and modify only their own Firestore branch.
- Public access requires a verified email.
- Paid access can be granted only by a verified server-side token claim.
- Client code and Git history must contain no private credentials.
- Account deletion must never affect another user's data or leave an active
  external grant behind.
- Payment webhooks must be authenticated, rechecked with the provider and
  processed idempotently.
- Future email OAuth tokens must use minimal scopes, encrypted server storage,
  bounded expiring state and reliable revocation.

## Reportable Findings

Report authentication bypasses, cross-account access, paid-plan forgery,
credential exposure, stored or reflected XSS,
payment verification bypasses and unauthorized email access.

## Known Limitations

The public Firebase deployment, payment backend and mailbox integration are
not live yet. App Check is defense in depth and does not replace authorization.
Local tests do not prove that production console settings are correct.

## Reporting

Do not publish vulnerability details in a public issue. Use GitHub private
vulnerability reporting after the repository is created, or the support
address published in the application.
