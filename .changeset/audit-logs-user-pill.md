---
'@10x-media/audit-logs': minor
---

The user column is now a pill that links to the user's document. An entry written under impersonation carries an `impersonated` mark in the same pill, which opens who was impersonating. A user who no longer exists shows as deleted instead of a raw id, and an unpopulated polymorphic user no longer renders as `[object Object]`. The row toggle moved to an overlay so the pill can hold a link, and the row is sized in admin units (`rem`, `--base`) instead of pixels.
