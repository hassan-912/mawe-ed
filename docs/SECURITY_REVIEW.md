# Security review — 14 October 2026

## Outcome and scope

The issues identified in this source review were corrected and covered by regression tests. This is a review of an MVP, not a penetration-test certification or a guarantee that every vulnerability has been found. Testing used disposable local accounts and an in-memory SQLite database; no live clients were scanned, no real notifications were sent, and no production credentials were published.

The reviewed surfaces were registration/login, cookies and sessions, employee/manager authorization, record reassignment, account administration, input handling, D1 transactions, push ownership/transport, scheduling, frontend rendering, secrets, and deployment configuration. Baseline reproduction used original commit `f9e3c6caaf3ef72de8560f58fcb7fc2dbb69ba04`. Feature planning preceded implementation in commit `2206e1d`.

## Confirmed issues and fixes

| Finding | Impact | Correction and evidence |
| --- | --- | --- |
| A former employee retained notification history for a reassigned case | Client names and preparation details remained accessible after ownership changed | Workspace history now joins the record's current owner and checks that the delivery owner agrees. Tests confirm the previous owner receives neither the case nor its messages/history. |
| Static assets bypassed the Worker's header middleware | The actual homepage had no CSP even though the Worker defined one | `run_worker_first: true` now routes assets through the Worker. The actual local homepage is checked for CSP and `no-store`, rather than relying on code inspection. |
| An expired/unknown session could not complete logout | Browser cookies survived the failed sign-out flow | Same-origin logout runs before authentication, expires the cookie, and removes known sessions and the matching account's device subscription. |
| Legacy hashes lacked a separate server secret | A database-only leak allowed offline password guesses against the stored derivation | New hashes use a server-secret HMAC after salted PBKDF2. Successful legacy logins replace the verifier with the protected format. The iteration limitation is explicitly documented below. |
| Invalid login emails created per-email limiter state | Anonymous requests could unnecessarily grow limiter rows and consume hashing resources | Bounded email validation precedes per-email state; IP limits precede expensive hashing. Tests confirm invalid email requests create no email limiter entries. |

## Additional controls

- Public registration cannot supply a role: it creates a **pending employee**. Pending users receive no company records/team list and cannot subscribe to company reminders. Existing staff remain active through the migration.
- Active employees access their assigned records. Manager-only handoffs and staff controls are checked on the server. The first manager is created by an administrator's CLI, not public registration.
- Manager-created staff must change their initial password before company access. Password changes verify the old password, use a compare-and-set update, advance the account session version, and disconnect old sessions and push devices.
- Sessions use random 256-bit tokens; D1 stores token hashes. HTTPS cookies are host-only, HttpOnly, Secure, SameSite=Strict. There is a seven-day absolute lifetime, twelve-hour idle expiry, and a twenty-session bound. Session listings expose public IDs and simple device labels, not token verifiers.
- Members can revoke other sessions after reauthentication or disconnect individual devices. A credential change racing with session revocation cannot destroy newly established sessions or create a false success event.
- Pausing employee access advances the session version, revokes sessions/subscriptions, cancels queued jobs, and excludes the owner from subsequent reminder scans. Jobs recheck the active owner before transport. A push already accepted by an external service cannot be recalled.
- Mutation requests require the same origin; cross-site fetches are rejected. JSON decoding is bounded to 16 KiB, requires an object, and rejects invalid UTF-8. Field whitelists prevent assigning protected IDs, role/state/version metadata, and forged handoff links.
- D1 statements bind data parameters. Dates, checklist keys/booleans, priorities, and account inputs are validated. SQL-looking names remain literal data in tests. The UI escapes client/staff content before rendering.
- Record edits use optimistic versions. Audit entries share the mutation transaction and require a matching mutation nonce, so stale writes cannot produce success history. Handoffs atomically create a case, convert the consultation, link it once, and cancel repeating follow-ups.
- Handoffs do not automatically copy manager notes into the employee case. Push messages exclude free-form notes. A user may hide client details in phone previews; encryption/decryption tests confirm the transmitted payload becomes generic.
- Subscription ownership is enforced; each account supports three devices. Push destinations allow known HTTPS vendor endpoints, reject arbitrary destinations/credentials/ports, and prohibit transport redirects. API responses omit private subscription material.
- HTTPS redirection, HSTS, CSP, frame blocking, MIME protection, and restricted camera/microphone/location permissions protect the actual Worker deployment. Authenticated responses are not cached by the service worker. Stale frontend requests cannot restore another account's data after logout.
- Anonymous login and registration limits, write limits, a pending-registration cap, and per-owner record caps reduce abuse. These do not replace infrastructure-level bot/DDoS protection.
- Secrets are generated into ignored files and are never printed. Both generators preserve existing secrets and work in either order. CI has read-only repository permission, pinned actions, and no retained checkout credentials.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **55 passed**, zero failed |
| `npm audit --audit-level=high` | Zero reported dependency vulnerabilities |
| `npx wrangler deploy --dry-run` | Passed; approximately 74 KiB Worker source bundle |
| `npm run verify:local` | Passed against the actual local Workers/D1 runtime: static security headers, login, workspace, case/checklist writes, activity, and session inspection |
| Browser workflow | Registration → pending sign-in → manager approval → consultation creation → handoff → checklist save → activity → employee-only case/history → sign-out |
| Responsive English UI | Checked 375, 768, and 1024 px widths; no page-level horizontal overflow. Dashboard, priority view, and registration screenshots are included. |

The supplied Code Reviewer scripts were run, but their analysis functions are placeholder implementations. Their “zero findings” output is not evidence of a clean security audit. Source review, reproduced behavior, real runtime checks, and regression tests provide the evidence above. Dependency auditing reports known advisories, not absence of all vulnerabilities.

## Remaining requirements and limits

**Password derivation:** the implementation retains Workers-compatible PBKDF2-HMAC-SHA256 at 100,000 iterations and adds a separate 32-byte server-secret HMAC. This is below [OWASP's 600,000-round PBKDF2 recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Pepper protection helps against database-only exposure; it does not compensate for a compromised Worker secret or satisfy that work-factor recommendation. Legacy verifiers remain unpeppered until their next successful login. Workers has historically limited native derivation iterations ([runtime issue](https://github.com/cloudflare/workerd/issues/1346)); stronger hashing should use an appropriate runtime or managed identity service rather than reducing authentication cost to meet a budget. Keep the pepper backed up and separate from database backups. Losing it requires an administrative credential-reset plan.

**Production performance:** no Cloudflare account/database was configured for this delivery. Free-plan CPU limits are tight, and local timing is not a production benchmark. Measure login, signup, password changes, and encrypted sends before accepting real traffic; do not promise that this authentication load will always fit a free allowance. Review [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and monitor quota/cost. Static requests also invoke the Worker to receive its headers, as [Cloudflare documents](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

**Identity:** email ownership is not automatically verified. Managers must verify a registrant's real staff identity through an existing company channel before approving. Email-based squatting and distributed signup abuse remain possible; registration may be closed by setting `REGISTRATION_OPEN=false`. MFA, breached-password screening, email recovery, and self-service forgotten-password recovery are not implemented. There is no production administrator password in the repo.

**Data and operations:** this is a single-company application. Managers see the company workspace; it is not a tenant platform. No passport/document uploads are needed for the checklist. Database administrators can modify history, so it is not a tamper-proof ledger. Establish backups, retention rules for client records/audit history, private vulnerability reporting, administrator recovery, and incident-response ownership before real use. Delivery history is pruned after ninety days; case and audit retention is administrative.

**Notifications:** push transport and service-worker behavior were tested with mocks, including encrypted payload decryption. Real Android/iPhone closed-tab delivery still requires HTTPS deployment, VAPID configuration, installed Home Screen app where required, and actual device permission/testing. Arrival time and exactly-once delivery cannot be guaranteed. The bounded five-minute scheduler is intended for a small team; increased volume can delay queues.

**Preview:** the existing Sites preview remains private and runs sample browser-local data. It deliberately disables credential submission and does not activate the Cloudflare backend. Use the README's actual deployment steps for accounts and real phone reminders.
