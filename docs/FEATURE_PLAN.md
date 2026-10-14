# Planned enhancements — 14 October 2026

This plan was written before feature implementation. The original workflows, Cairo timezone, light sage theme, and free-hosting deployment target remain in place.

## Required account and security work

Public registration creates an employee account with pending membership. Registrants may sign in and see their approval state, but cannot read or modify company records until a manager approves them. Public requests cannot choose a manager role. Existing accounts remain active through a versioned database migration. Account approval is an organizational access check, not proof of email ownership; managers must verify new staff identity before approving.

Harden the API's input validation, HTTPS/cookies, rate limits, revoked access, notification ownership, session lifecycle, and password storage. Add self-service password changes, revoke other sessions, and remove registered notification devices. Preserve legacy password compatibility while upgrading credentials with a server-held pepper. Record sensitive administrative actions without logging passwords, session tokens, push endpoints, or client notes.

## Feature 1: Today's priorities

**Problem:** urgent work is spread across the two portals and the task list.

**Implementation plan:**

1. Add a shared deterministic priority builder using Cairo dates and the existing reminder rules.
2. Sort overdue preparation, due follow-ups, urgent tasks, and upcoming deadlines; allow record priority to be Normal, High, or Urgent.
3. Add a Today navigation item with actionable links to the existing case, consultation, and task editors.
4. Respect assigned-record visibility and completed/archived states.

**Acceptance:** overdue and due-today items appear ahead of future work; completed/archived items do not reappear; employees see only their assigned work; keyboard and phone layouts work.

## Feature 2: Consultation-to-case handoff

**Problem:** after a successful consultation, a manager must retype the client's information and separately stop follow-ups.

**Implementation plan:**

1. Add a manager-only handoff form for destination/purpose, embassy date, and employee assignment.
2. Create the case and close the consultation's active follow-up in one D1 transaction.
3. Link the resulting case to its source consultation and prevent duplicate conversion during retries or concurrent requests.
4. Use the existing four-day preparation deadline and earlier reminder start.

**Acceptance:** one handoff creates exactly one case, retains the client name and phone, stops consultation reminders, and makes the case visible to the assigned employee. Invalid dates, inactive staff, stale versions, and employee callers cannot perform a handoff.

## Feature 3: Activity history

**Problem:** the team cannot see which colleague completed a document or moved a deadline.

**Implementation plan:**

1. Add a server-written append-only audit table with actor, action, target, timestamp, and a minimal summary.
2. Write history entries in the same transaction as successful record/account changes.
3. Add Activity navigation and recent history in case detail, with scoped employee access and manager oversight.
4. Avoid including free-form notes, passwords, credential hashes, or push subscription material.

**Acceptance:** changing a checklist, deadline, assignment, or consultation status creates a meaningful event. Failed or conflicting writes create no success event. Employees lose visibility to a record's history after reassignment and cannot edit audit entries.

## Delivery and verification

Add regression tests for each confirmed security issue and each feature boundary. Check the actual Workers/D1 local runtime, browser workflows, mobile layout, dependencies, secret exclusions, and English-only branding. Update the README and security report with exact results and remaining deployment requirements. Push all finished source, tests, assets, plans, and reports to `hassan-912/mawe-ed`. Update the existing private demo without changing its sharing policy.
