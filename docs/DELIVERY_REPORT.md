# Maw‘id delivery — 14 October 2026

The project now includes employee signup/sign-in with manager-approved membership, account security controls, English-only app copy and branding, and the three enhancements planned in [FEATURE_PLAN.md](FEATURE_PLAN.md) before implementation. The calm ivory/sage/terracotta theme and existing MG company logo are preserved.

## Three new features

1. **Today’s priorities:** one place to open incomplete preparation, follow-ups, and daily/one-off tasks, with Normal/High/Urgent record priority and Cairo-based dates. Completed, archived, and undefined Canada/UK preparation workflows do not appear as actionable checklist work.
2. **Consultation handoff:** managers can create an assigned employee case directly from a consultation. The client name/phone and priority carry forward; manager-only notes require a separate intentional employee note. A transaction prevents duplicate cases and stops consultation reminders.
3. **Activity history:** successful changes show the actor, action, target, and Cairo time. The history is server-written and scoped to current record access; stale edits cannot create misleading success entries.

![Today’s priorities](mawid-priorities.jpg)

## Accounts

Create an account → sign in → wait for a manager to verify identity and approve membership. Pending users cannot view company data or select a manager role. The administrator creates the first manager using the CLI. Manager-created staff change their initial password before access.

Account security includes password changes, session/device inspection and revocation, and private phone previews. Managers can pause/reactivate employee access. No real production account or shared default password has been created.

![Registration interface](mawid-registration.jpg)

## Security and validation

The review corrected identified privacy, logout, limiter, password-verifier, and deployment-header issues. It added regression coverage and hardened role checks, sessions, input handling, push privacy, and transactional history. **55 tests passed**, dependency auditing reported zero vulnerabilities, the actual local Workers/D1 runtime passed, and the deployment dry-run passed. Browser testing covered the complete account/approval/handoff/checklist/history workflow and phone/tablet layouts.

The full findings, evidence, and limitations are in [SECURITY_REVIEW.md](SECURITY_REVIEW.md). This is not a claim that every security weakness has been eliminated: the hashing work factor, email verification/recovery/MFA, infrastructure operations, and real-phone testing need the documented production decisions.

## What to do when you return

All application source, migrations, tests, assets, feature plans, and explanations are in [hassan-912/mawe-ed](https://github.com/hassan-912/mawe-ed). Generated secrets, local databases, synthetic account seeds, and installed dependencies are excluded from Git and the source archive. GitHub Actions verifies future pushes without deployment credentials.

The [private sample preview](https://mawid-reminder-mg.woollyberry9.chatgpt.site) uses browser-local sample data. Real accounts and closed-tab phone reminders require your Cloudflare account, D1 database, account/VAPID secrets, and actual device permission tests. Follow the [README deployment and upgrade steps](../README.md); no paid service was activated. Preserve the account security key when upgrading an existing installation.
