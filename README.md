# Maw‘id — موعد

**A little ahead, always.** A light, calm reminder workspace for company consultations, visa preparation, everyday tasks, and exceptional tasks. Built with ivory, sage, and restrained terracotta. The existing MG company logo is preserved; the new bell/check mark identifies the reminder app.

## What is ready

- An interactive, responsive demo with sample clients. Both portals can be explored without signing in. Demo changes stay in the browser and do not send messages.
- A separate Cloudflare Workers/D1 backend with account login, server-enforced roles, assigned records, encrypted browser push, and scheduled reminders.
- An installable PWA manifest, phone icons, and a service worker that handles incoming pushes even when the tab is closed.
- Deployment instructions below. Real hosting/database/phone delivery are **not activated** by opening the static demo.

## Recommended free stack

| Part | Choice | Reason |
| --- | --- | --- |
| Interface | Small JavaScript web app / PWA | Runs on desktop and phone; no app-store subscription |
| Hosting and API | Cloudflare Workers + Static Assets | One deployment for the app, API, and scheduler |
| Database | Cloudflare D1 / SQLite | Staff accounts, assigned cases, tasks, and notification history |
| Scheduling | Cloudflare Cron Triggers | Runs on the server while all browsers are closed |
| Phone delivery | Standards-based Web Push / VAPID | No SMS or WhatsApp message charges |

This can fit the free tier for a small company. Free quotas are limits, not an unlimited service guarantee. At the time checked, Workers Free includes 100,000 requests/day and D1 includes 5 million row reads/day, 100,000 row writes/day, and 5 GB total storage. A custom domain is optional and may cost money. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

### Notifications with the website closed

These use server-sent push and a service worker, not timers in an open webpage. [MDN explains receiving push while an app is not loaded](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

- Android: Chrome/Edge with site notifications allowed. Installing the PWA is useful but is not a prerequisite on all supported Android browsers.
- iPhone/iPad: add the app to the Home Screen, open that installed app, and allow notifications. Supported on iOS/iPadOS 16.4 and later; see [WebKit’s explanation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
- Desktop: supported Chrome, Edge, Firefox, or Safari with permission granted. Browser background behavior and OS settings vary.

Closing the **website tab** is supported. Delivery cannot be guaranteed if the browser is force-stopped, notifications are blocked, the phone is offline, or Focus/battery settings suppress them. The delivery history records push-service acceptance, not proof that a person saw the notification. There is no dependable universal free SMS/WhatsApp production option assumed here.

## Reminder rules

### Manager portal

Record client name, consultation date, recommended destination, assigned manager, and notes. The interface shows how many days have passed since the consultation.

- Default interval: 48 hours.
- Custom interval: 1–720 hours, or choose the exact next reminder in Cairo time.
- The first reminder defaults to consultation day at 10:30 plus the chosen interval. Enter an exact next time when a different anchor is needed.
- “Followed up today” records the contact and schedules the next interval from now.
- Snooze 24 hours, mark “Moved forward” or “Closed,” or archive to stop follow-ups.
- Notifications go to the assigned manager, not to the client.

### Employee portal

| Destination / purpose | Checklist |
| --- | --- |
| Schengen tourism | Hotel, Flight, Application, Aman, Travel plan, Motivation letter, Translation |
| Schengen business | Same seven items, plus Conference |
| USA | Hotel, DS-160 application, US Travel Docs |
| Canada and UK | Under processing; case tracking only, no unspecified checklist |

“Aman” is kept exactly as supplied in the brief. Confirm its internal meaning before renaming it.

- Preparation deadline = embassy appointment minus **four calendar days**.
- Default reminder start = preparation deadline minus **four more days**, following your preference to begin earlier.
- Staff can choose any reminder start on or before the preparation deadline.
- Reminders are scheduled at **10:30 and 15:00, Africa/Cairo**.
- Messages list only unchecked items and show both the preparation deadline countdown and the embassy appointment countdown.
- Reminders continue when overdue until complete or archived. Moving the appointment recalculates its preparation deadline; a custom start is validated against the new deadline.
- Fully checked cases stop preparation reminders. Canada/UK never count as ready just because their checklist is not defined.

Example: appointment **18 October 2026** → preparation deadline **14 October** → default reminders start **10 October**. On 12 October, the message says “2 days left until the preparation deadline” and “6 days left” until the embassy appointment. On 15 October, it says preparation is overdue, rather than implying the employee still has preparation time left.

### Everyday and exceptional tasks

Each task has an owner, time, date, and daily or one-off frequency. Daily completion resets on the next Cairo calendar day. One-off completion remains complete. Both can create push notifications. Cairo time is calculated with `Intl`, including daylight-saving changes; follow-up intervals remain elapsed hours.

## Explore locally

Requires Node.js 24 or later for the built-in SQLite tests.

```powershell
npm ci
npm run preview
```

Open the printed local URL. Use `npm.cmd` instead of `npm` if PowerShell blocks the npm script shim.

## Deploy the actual app for free

Run these from this project directory. The `.openai/hosting.json` file belongs to the private **Sites demo**; Cloudflare uses `wrangler.jsonc` for the actual application.

1. Create/use a Cloudflare account on the Free plan and sign in:

   ```powershell
   npx wrangler login
   npx wrangler d1 create mawid
   ```

2. Copy the returned `database_id` into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

3. Initialize the remote database and create your first manager:

   ```powershell
   npm run db:remote
   npm run create-manager
   npx wrangler d1 execute mawid --remote --file bootstrap-manager.sql
   Remove-Item -LiteralPath .\bootstrap-manager.sql
   ```

   The helper prompts for the manager’s name, email, and password. Password input is hidden. The SQL contains a salted password hash, not the password. Use the manager’s real email as the account identifier; this app does not send an email invitation.

4. Deploy the application:

   ```powershell
   npm run deploy
   ```

   The `workers.dev` address provides HTTPS and does not require buying a domain. The first deployment can be opened and signed into before push keys are configured.

5. Generate and upload push keys:

   ```powershell
   npm run push:keys
   npx wrangler secret bulk push-secrets.json
   ```

   Enter your administrator email for the VAPID contact. Keep `push-secrets.json` and `.dev.vars` private; both are ignored by Git. The private key is a server secret. The public key is intentionally returned to signed-in browsers through `/api/config`. The key helper refuses to overwrite existing keys. Preserve the keys; changing them requires staff to subscribe again.

6. Sign in as the manager, use **Settings & team → Add staff member**, and share each initial login privately. Staff can then sign in to their own portal.

7. On each staff phone, open/install the app and tap **Settings & team → Enable on this device**, then approve the browser/OS notification prompt. Each account supports up to three devices. Signing out turns off notifications on that browser; other subscribed phones remain connected.

8. Confirm delivery on the actual phones: create a one-off task a few minutes ahead, close the app tab, and wait for its notification. Also validate the two case-reminder times and a shortened test consultation interval. This acceptance test is still required; no real account/device subscription was available during development.

## Validation and operating limits

```powershell
npm test
npx wrangler deploy --dry-run
```

28 tests passed, covering exact checklists, deadline calculations, Cairo daylight-saving changes, permissions, optimistic concurrency, encrypted push/decryption, subscription ownership, endpoint restrictions, idempotent slots, retries, and the service-worker notification handler without an open page.

The actual local Workers/D1 runtime was also checked for login, authenticated reads, creating a case, and saving checklist changes. To repeat that check, start `npm run dev` in one terminal and run `npm run verify:local` in another. That helper creates and removes only its named local test account and records. Do not enable real push keys for a synthetic test account.

Browser QA included checklist editing and message updates, both portals, date previews, search, and responsive layout. The 375px layout has no page-level horizontal overflow. The supplied Code Reviewer scripts were executed, but their analysis functions are placeholders; their “zero findings” result is not treated as a substantive audit. Manual review and the tests supply the actual verification.

The scheduler checks every five minutes, scans up to six due records, and handles up to three queued reminders per run, with up to three subscribed devices per account. This stays within small free-plan invocation budgets. Times are scheduling targets: queues, outages, push services, and device settings can delay delivery. For a larger team, measure queue depth and increase capacity with a suitable plan or queue design. It retries transient failures up to five times, records failures, removes expired device subscriptions, and remembers devices whose push services already accepted a notification.

No notification system can promise exactly-once delivery across a network failure. Saved receipts and notification tags reduce duplicates; an ambiguous failure after a push service accepted a message can still result in a retry. Superseded reminders are cancelled, and missed morning case messages are replaced by the current afternoon slot.

Staff must keep notification permission enabled. An expired subscription requires enabling notifications again. The source is an MVP; account recovery, MFA, detailed administrative audit logs, and more granular organizational permissions are future additions rather than claimed features.

## Project files

- `dist/`: app interface, shared date/reminder logic, service worker, manifest, and brand assets.
- `server/`: Workers API, password/session handling, D1 schema, push transport, and scheduler.
- `tests/`: scheduling, API, SQLite, encryption, and service-worker verification.
- `scripts/`: preview, initial manager, push-key generation, brand export, and local runtime verification.
- `wrangler.jsonc`: free Cloudflare deployment configuration.

The SVG logo is editable at `dist/assets/mawid-logo.svg`. The icon is `dist/assets/mawid-mark.svg`. The existing company logo is `dist/assets/company-logo.svg`. The bundled Noto Sans font retains its OFL license.
