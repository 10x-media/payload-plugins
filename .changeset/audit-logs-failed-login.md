---
'@10x-media/audit-logs': minor
---

Refused logins can be audited, so a password-guessing run is visible as one.

- Added: `auth.failedLogin` on a collection records attempts Payload turned away, as `operation: 'auth'`, `eventType: 'failed_login'`. The entry carries the caller's IP and user agent plus `metadata: { identifier, reason }`, where `reason` is `invalid_credentials`, `locked` or `unverified`. No user is recorded: Payload answers identically whether the account exists or the password was wrong. The submitted password is never read, and the identifier is capped at 256 characters.
- `failedLogin` is not part of `auth: true` and has to be named. Unlike the other auth events it follows a request nobody authenticated, so one attempt is one row at whatever rate a caller can send. `auth.failedLogin.shouldLog` decides whether an attempt becomes a row, which is where a burst gets collapsed or turned into an alert instead. The docs carry a worked example and the security note.
- The events come from the collection's `afterError` hook, so REST only. Attempts through GraphQL or `payload.login()` produce no entry.
- The logs view filters on the new event alongside the existing two.
