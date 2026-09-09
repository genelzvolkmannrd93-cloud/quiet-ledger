# Quiet Ledger: release gates

Updated 2026-09-09. This checklist records local evidence and does not claim that the current Firebase site has been updated.

## Verified locally

- Public and private builds are separate. Public deployment uses `firebase.public.json`, public Firestore rules and explicit public mode; the default remains private and `noindex`.
- Public sign-in supports Google and email/password. Email accounts must verify their address before application data loads.
- Firestore rules isolate every account, reject anonymous and unverified access, validate document schemas and enforce the three-subscription free limit independently of browser code.
- Account deletion creates an immutable UID-only tombstone before bounded cleanup, then deletes the matching Firebase Authentication account. Old sessions cannot recreate deleted data.
- Subscription creation, editing, pause/resume, deletion, recurring dates, calendar projection, currency-separated totals and settings are covered by local tests.
- The interface supports Russian and English. The choice is stored per account and restored after a new sign-in.
- Backup download and restore were removed by product decision. No backup controls or parser are shipped in the public bundle.
- Internal security codenames and technical protection details are absent from the user interface. Authorization, App Check, database rules and protective headers remain active underneath.
- Privacy and terms pages are available before sign-in and from settings. The configured support address is public; owner credentials and private Firebase settings are excluded from Git.
- The source scanner rejects tracked private keys, OAuth codes, known token formats, non-empty secret variables and local owner identifiers.
- The public browser scenario runs against local Auth/Firestore emulators with two accounts and mobile width. It checks data isolation, settings persistence, language switching, removal of obsolete UI, logout and account deletion.
- The Gmail OAuth server foundation is intentionally not deployed. Live Gmail access, KMS/IAM, Google verification and message discovery remain disabled.
- Paid subscriptions remain disabled until a trusted provider backend, verified webhooks and owner onboarding exist.

## Still required for a public service

- Upload the reviewed source to the chosen public GitHub repository and confirm the CI run.
- Deploy the public build and public rules to Firebase, then repeat account, mobile and deletion checks on the live address.
- Owner review of the final privacy and terms wording.
- Gmail production approval and payment integration are later, separate launch stages. A custom domain is deferred.

No live deployment is implied by local test results. Stripe and Resend are not enabled.
