# @10x-media/audit-logs

## 0.1.0-beta.0

### Minor Changes

- `payloadAPI` accepts values Payload core never defines.

  - Fixed: a value outside `REST`, `GraphQL` and `local` failed the log write with `payloadAPI: 'MCP' is not a valid enum value`, and the audited operation failed with it. `@payloadcms/plugin-mcp` sets `req.payloadAPI = 'MCP'` on every request it serves. The field is now `text` instead of `select`, and any value is recorded without configuration.
  - Added: `logs.payloadAPIs` labels the values a project expects, on top of the three core sets. A bare string is its own label; an entry naming a built-in relabels it in place. It drives the badge in the logs view only, never validation, so an undeclared value still renders, as its raw string.
  - Postgres hosts need one migration for the column type; the enum values cast to text unchanged, so no data moves. Mongo needs none.

- Refused logins can be audited, so a password-guessing run is visible as one.

  - Added: `auth.failedLogin` on a collection records attempts Payload turned away, as `operation: 'auth'`, `eventType: 'failed_login'`. The entry carries the caller's IP and user agent plus `metadata: { identifier, reason }`, where `reason` is `invalid_credentials`, `locked` or `unverified`. No user is recorded: Payload answers identically whether the account exists or the password was wrong. The submitted password is never read, and the identifier is capped at 256 characters.
  - `failedLogin` is not part of `auth: true` and has to be named. Unlike the other auth events it follows a request nobody authenticated, so one attempt is one row at whatever rate a caller can send. `auth.failedLogin.shouldLog` decides whether an attempt becomes a row, which is where a burst gets collapsed or turned into an alert instead. The docs carry a worked example and the security note.
  - The events come from the collection's `afterError` hook, so REST only. Attempts through GraphQL or `payload.login()` produce no entry.
  - The logs view filters on the new event alongside the existing two.

- Initial beta of `@10x-media/audit-logs`: audit fields and change logging for Payload v3.

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
  - **Admin view**: a browsable log at `/admin/audit-logs` with URL-held filters on collection, global, operation, user, changed path, event type, group and date range, and `forceWhere` for scoping it. Compound indexes pair each of those filters with the sort key, and the list populates only the field it displays. Opening it without a session redirects to the login page and returns to the same filtered list afterwards.
  - **Typed reads**: `typedDiff<T>` and `typedSnapshot<T>` restore precise types to Payload's wide JSON fields, with `DiffPaths<T>` and `DiffPathValue<T, P>`.
  - **Typed translations** shipping `en`, `de` and `uk`, with per-key overrides via `@10x-media/audit-logs/i18n`.
  - **Writes**: entries go straight to the database adapter rather than through the operation pipeline, which keeps a long migration from accumulating memory; attaching hooks through `logs.override` switches the plugin back to the pipeline so they still fire. Every write joins the transaction of the operation that triggered it, so a rollback leaves no entry behind.
  - **Cross-DB**: tested on MongoDB and PostgreSQL via the matrix integration suite.
