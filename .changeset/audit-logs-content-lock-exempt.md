---
'@10x-media/audit-logs': patch
---

The `audit-logs` collection exempts itself from `@10x-media/content-lock`, so a lock can no longer reject an entry and fail the write that produced it.

- Fixed: during a lock on everything, the lock rejected every entry written through `payload.create` with a 503, and the operation that triggered the entry failed with it. Entries take that path once `logs.override` attaches hooks, so a login to a collection with `auth` events failed, and so did an audited write to a collection the lock leaves open. `createAuditEvent` always takes it, so custom events failed without any override. The retention jobs could not delete entries or stamp `archivedAt` either.
- The collection now carries `custom: { contentLock: { exempt: true } }`, applied after `logs.override` the same way the slug is, so an override cannot drop it. Since no lock can freeze it, a content-lock group that names `audit-logs` now fails the build.
- The archive job still uploads into `archive.uploadCollection`, which a lock freezes unless you exempt it. A run during the lock then fails before stamping anything, and the first run after the lock ends archives the same entries.
