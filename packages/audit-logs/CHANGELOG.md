# @10x-media/audit-logs

## 0.1.0-beta.4

### Minor Changes

- The view filters by the API an entry came through. More filters offers `REST`, `GraphQL`, `local` and every `logs.payloadAPIs` entry under its label, takes several at once, and accepts any other value typed in.

- `logs.view.components.customEvents` renders custom events with your own components instead of the default table and JSON block. Keys are `eventType` values, `'*'` is the fallback and `false` keeps the default. Renderers run on the server with `payload` and `req`, receive `CustomEventComponentProps` (exported from `@10x-media/audit-logs/types`), and are registered in the import map by the plugin.

- The view's filters are rebuilt. One row of pills (Event, Collection, User, Date, More filters) opens each editor in a panel below it, the way the list view opens columns and filters, and changes are applied together.

  - Event folds operation and event type into one filter, with several values at once; custom types come from the new `logs.eventTypes` option and the renderer keys, and the label also shows on the row badge.
  - Documents and users are picked from the list drawer, or typed as an id for something deleted, and the pills show their titles instead of ids.
  - Collections and globals are labelled from their config, and Payload's own bookkeeping collections are no longer offered.
  - Date presets fill the From date; documents, groups and changed fields take several values each.

  Filter URLs changed: repeated `eventType`, `documentId`, `userId` and `group` keys, `slug:id` references, and no `userCollection`.

- Record the impersonator on an audit entry when the acting user was reached through impersonation. The list names the acting user and shows who was impersonating them.

  The `impersonator` field is added only when `@10x-media/impersonation` is installed. `impersonation: false` keeps it out, `impersonation: true` adds it without the plugin.

- `multiTenancy.collections` names the tenant-scoped collections in the multi-tenant plugin's own shape, so one object configures both plugins. When set, only those collections and the tenants collection record a tenant, instead of any collection with a field named `tenantFieldName`. The tenant view's filters follow it: they offer only collections that can carry a tenant, no real globals, and `isGlobal` collections as globals.

- The user column is now a pill that links to the user's document. An entry written under impersonation carries an `impersonated` mark in the same pill, which opens who was impersonating. A user who no longer exists shows as deleted instead of a raw id, and an unpopulated polymorphic user no longer renders as `[object Object]`. The row toggle moved to an overlay so the pill can hold a link, and the row is sized in admin units (`rem`, `--base`) instead of pixels.

### Patch Changes

- Auth events and deletes no longer record `locale`: a login has no document, and a delete removes every locale, so the request's locale said nothing about either. The view hides it on such entries written before.

## 0.1.0-beta.3

### Patch Changes

- The `audit-logs` collection exempts itself from `@10x-media/content-lock`, so a lock can no longer reject an entry and fail the write that produced it.

  - Fixed: during a lock on everything, the lock rejected every entry written through `payload.create` with a 503, and the operation that triggered the entry failed with it. Entries take that path once `logs.override` attaches hooks, so a login to a collection with `auth` events failed, and so did an audited write to a collection the lock leaves open. `createAuditEvent` always takes it, so custom events failed without any override. The retention jobs could not delete entries or stamp `archivedAt` either.
  - The collection now carries `custom: { contentLock: { exempt: true } }`, applied after `logs.override` the same way the slug is, so an override cannot drop it. Since no lock can freeze it, a content-lock group that names `audit-logs` now fails the build.
  - The archive job still uploads into `archive.uploadCollection`, which a lock freezes unless you exempt it. A run during the lock then fails before stamping anything, and the first run after the lock ends archives the same entries.

## 0.1.0-beta.2

### Patch Changes

- **Behavioral (build output only):** the shared build now keeps `next` and its subpaths external, so the published files import `next/navigation` as a bare specifier instead of the resolved `next/navigation.js`. Nothing changes at runtime on Next 15 or 16, which resolve both forms; the bare form stays correct if Next ever adds an export map.

## 0.1.0-beta.1

### Minor Changes

- More built-in locales for the `auditLogs:` strings.

  - Added: `es`, `fr`, `id`, `pt`, `ru`, `zh`, `ar`, `ko`. Every key is covered in each.

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
