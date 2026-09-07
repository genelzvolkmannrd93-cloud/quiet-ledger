# Quiet Ledger: payment and mail integration plan

Updated 2026-09-07. This document records the implementation boundary; it is not proof that either integration is live.

## Launch sequence

1. Finish and verify the free three-subscription service locally, keeping mailbox and paid features disabled.
2. Add the custom domain and publish the minimum verified homepage, terms and privacy pages required for Google production review.
3. Implement Gmail discovery behind a disabled feature flag, complete consent/revocation/deletion testing, then submit the exact production scopes for Google verification before enabling the control.
4. Complete self-employed merchant onboarding and implement the YooKassa candidate in its test shop as the final product integration.
5. Re-run the complete release gate and repository-wide security review, then publish the reviewed source to GitHub and activate only the integrations whose external approvals are confirmed.

The app can technically run on the Firebase Hosting address without a custom domain, but the planned Gmail production verification requires a homepage and legal pages on a verified domain owned by the operator. Payment and Gmail credentials are never prerequisites for local builds or tests.

## Payments

Selected candidate: YooKassa for a Russian self-employed owner. Its current official documentation supports Russian-issued cards including Mir and saved-card recurring payments. An ordinary individual must first register as self-employed, create an identified YooMoney wallet and apply for YooKassa for self-employed merchants. Merchant settlement details are established inside the provider agreement; a personal card number must never be collected by Quiet Ledger or committed to this repository.

### Owner-only prerequisites

- active self-employed status and INN;
- identified YooMoney wallet and approved YooKassa merchant/test shop;
- owner review of the provider agreement, fees and settlement details;
- final monthly and yearly prices in RUB;
- receipt workflow through `Мой налог` and delivery of the receipt to the buyer;
- backend hosting decision if Firebase Functions cannot be enabled on the current Google billing setup.

Passport, INN, bank, wallet and card data belong only in the provider's authenticated onboarding flow. They must not be sent through issue trackers, chat, client-side environment variables or GitHub.

### Backend contract

- `POST /billing/checkout`: verify the Firebase ID token, use the server-owned price, create one YooKassa payment with a unique idempotency key, and return only the provider confirmation URL.
- `POST /billing/webhook`: accept only supported event types, fetch the payment from YooKassa using server credentials, compare amount/currency/account metadata, process the provider payment ID idempotently, then update entitlement state.
- `POST /billing/cancel`: stop future server scheduling and revoke the entitlement at the paid-through boundary.
- A scheduled server job creates recurring charges using a saved `payment_method_id`; the browser never initiates an unattended charge.
- Store only provider identifiers and lifecycle state. Never store a full card number or CVC. Display at most provider-supplied masked details.
- Paid writes must go through a trusted quota authority with a finite account cap. Direct arbitrary-ID Firestore writes remain denied.
- Every entitlement transition—activation, renewal, failure, cancellation, refund and expiry—must have emulator/unit coverage plus YooKassa test-shop verification.

No `shopId`, secret key, payment method identifier or webhook credential exists in the repository today. `VITE_PAID_FEATURES_ENABLED=false` and the release checker prevent accidental activation.

## Gmail discovery

Ordinary Google sign-in remains separate from mailbox authorization. The current app requests no Gmail scopes and cannot read messages.

The endpoint, storage, minimization, deletion and test contract is specified in `GMAIL_INTEGRATION_SPEC.md`. That document is preparation only and does not authorize or enable mailbox access.

### Required design

- use a separate explicit “Connect Gmail” consent flow after sign-in;
- request the narrowest scope that supports the implemented discovery feature; do not request Gmail access for future functionality;
- keep refresh/access tokens encrypted on a trusted backend and out of Firestore client-readable paths;
- search only for likely receipt/subscription messages and retain extracted subscription facts rather than full message bodies whenever possible;
- show proposed matches for user confirmation before creating tracker records;
- provide disconnect, token revocation and deletion controls;
- document Google API data use separately in the public privacy policy;
- prepare a public homepage, terms, privacy policy, verified domain, scope justification and end-to-end demonstration video;
- complete Google's OAuth verification and any required restricted-scope security assessment before public activation.

The disabled Gmail control in Settings is informational only. It must not be enabled until the backend, consent flow, deletion path, verification materials and a new security scan are complete.

## Mail reminders

In-app reminders work today. External email reminders and weekly summaries are disabled until a transactional mail provider and sender domain are selected. Gmail mailbox access must not be reused to send bulk product mail. The eventual reminder worker must be server-side, rate-limited, opt-in, unsubscribe-aware and idempotent.

## Mandatory review gates

- public support/privacy email and final owner identity in legal documents;
- provider credentials stored only in backend secret storage;
- webhook replay/forgery tests and reconciliation job;
- finite paid quota and downgrade migration tests;
- OAuth token encryption/revocation/deletion tests;
- updated threat model and repository-wide security scan;
- live sandbox verification before any production credential or paid UI is enabled.
