---
'@10x-media/audit-logs': minor
---

Initial beta of `@10x-media/audit-logs`: audit fields and change logging for Payload v3.

- **Audit fields**: `createdBy` and `lastModifiedBy` as read-only relationship fields, added automatically or declared by hand inside a group or tab via `isManual`. Polymorphic when the config has several auth collections, with a read-only component that links into the related document when the viewer can read it.
- **Change log**: one entry per create, update and delete in an `audit-logs` collection, each with a flat dot-notated diff, the acting user, locale, API, IP and user agent. Opt in per collection and per global; an update whose diff is empty writes nothing.
- **Diff engine**: array and blocks rows are keyed by row id, so a field change is `steps.abc.title` and a reorder is one `steps.__order__` entry. Relationship values are normalized to plain ids from the collection schema, so a populated hook payload never reads as a change.
- **Scoping**: `operations`, `excludeFields`, `drafts` (autosaved drafts are skipped by default), and a per-event `shouldLog` predicate that runs after the diff.
- **Snapshots**: `snapshotOnCreate` and `snapshotOnDelete` store the whole document, which is what makes a deleted document recoverable from its entry.
- **Anonymization**: a function per collection or global that drops or rewrites values before they are written, applied to diffs and snapshots alike, keeping the changed path while losing the value.
- **Auth events**: logins and password resets, opted into per collection with `auth`, next to that collection's other options.
- **Custom events**: `createAuditEvent(req, ...)` records business events that are not field changes, with arbitrary `metadata`.
- **Retention**: `audit-logs-archive` exports unarchived entries to a gzipped CSV in an upload collection and stamps `archivedAt`; `audit-logs-delete` removes what was archived. Both are Payload jobs with cron schedules, lifecycle hooks and `Where` scoping.
- **Multi-tenancy**: a `tenant` field on every entry plus a tenant-scoped view reading the `payload-tenant` cookie, matching `@payloadcms/plugin-multi-tenant` defaults. The tenants collection is recognised as its own tenant.
- **Admin view**: a browsable log at `/admin/audit-logs` with URL-held filters on collection, global, operation, user, changed path, event type, group and date range, and `forceWhere` for scoping it.
- **Typed reads**: `typedDiff<T>` and `typedSnapshot<T>` restore precise types to Payload's wide JSON fields, with `DiffPaths<T>` and `DiffPathValue<T, P>`.
- **Typed translations** shipping `en`, `de` and `uk`, with per-key overrides via `@10x-media/audit-logs/i18n`.
- **Cross-DB**: tested on MongoDB and PostgreSQL via the matrix integration suite.
