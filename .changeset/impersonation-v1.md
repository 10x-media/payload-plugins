---
'@10x-media/impersonation': minor
---

Initial beta of `@10x-media/impersonation`: an authorised account can sign in as another user without their password. After start, `req.user` is the target. Every session is a closed-never-deleted row. Exit, logout, or remote terminate ends it.

- **Mandatory `access.impersonate`**: only the literal `true` allows. A Payload `Where` object is deny. Start also reads the target with `overrideAccess: false`.
- **Minted target session**: `db.findOne` + `addSessionToUser` + `jwtSign` + cookie. Active means an open row whose `targetSid` matches `req.user._sid`, so Payload refresh cannot hide the bar.
- **Plugin-owned origin gate** on cookie POSTs. JWT/Bearer skip it only when `jwtOrder` ranks that scheme before `cookie`.
- **Swap or parallel**: parallel only when `@10x-media/dual-session` isolated the target. Hint cookie is never trusted alone.
- **Admin UI**: Switch to user, Acting as bar (including `/admin/unauthorized`), document action, End session on the record.

Requires Payload `^3.83.0`. Dual-session is an optional peer.
