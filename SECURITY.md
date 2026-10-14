# Reporting a security issue

Do not post passwords, session tokens, client information, notification subscription keys, or a working exploit against a live installation in a public issue.

Use GitHub's private vulnerability reporting if the repository owner has enabled it. Otherwise contact the company administrator privately; the owner must provide that reporting channel before production use. This repository does not claim an active security-response service.

See [the review and operating requirements](docs/SECURITY_REVIEW.md). Keep dependencies, deployment secrets, account approvals, and phone notification permissions under administrator control. The app is intended for one company; it does not provide tenant isolation between unrelated organizations.
