---
"@10x-media/dual-session": minor
---

Support one auth collection with roles backing both sessions, via an `isolate` predicate.

A collection entry now accepts `isolate: (user) => boolean`, which decides per user rather than per collection which cookie a session lands in. Users it returns `false` for keep the shared `${cookiePrefix}-token`, so projects with a single `users` collection gated by `access.admin` can hold an editor's admin session and a website visitor's session in one browser. This is also the only way to list the collection named by `admin.user`: listing it without a predicate still throws, and giving that entry the `admin` scope now throws too, because an isolated cookie answering admin-scoped requests would outrank the admin's own session.

The shared cookie the plugin writes for a non-isolated user is the same string `generatePayloadCookie` produces, so the admin half is core behaviour untouched. All six shadowed endpoints resolve the cookie from the user in front of them, except `first-register`, which always writes the shared cookie because the first user has no roles yet to classify. In development, a login routed to the isolated cookie for a user who would pass `access.admin` logs a warning, so a predicate that disagrees with the admin gate is not silent.

`generateIsolatedAuthCookie` and `resolveIsolatedCookieName` take an optional `user`, required for a collection configured with `isolate` — they throw rather than guess which cookie to write.
