# @10x-media/content-lock

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/content-lock`: planned and unplanned maintenance windows that freeze Payload content.

  - **Windows**: a `content-locks` collection with drafts, derived stages (pending, announced, active, ended) shown as pills with list quick filters, optional announcement and end time, time zone pickers, Lock now and End now actions, and ended windows kept read-only as history.
  - **Enforcement**: a `beforeOperation` guard rejects create, update (autosave included), delete and restores with `ContentLockedError` (503, `Retry-After`) on REST, GraphQL, the admin and the Local API, including `overrideAccess: true`. Wrapped access renders the admin read-only in scope. State lives in a `payload.kv` snapshot and fails closed.
  - **Scope**: everything, configured groups, individual collections and globals (`individualSelection`), or custom targets that project code checks, with admin paths that scope the banner on custom views. `exempt`, collections marked `custom.contentLock.exempt`, and Payload's system collections stay writable.
  - **Banner**: one window at a time with a pager, active first, filtered to the current collection or global, announcements dismissible per user. Per-window localized messages with lock value tokens (start, end, announcement, scope, date) rendered live in the viewer's time zone, `localeMap` for admin language to content locale, and `editor.features` / `editor.converters` to extend the editor.
  - **Jobs**: with `@10x-media/jobs`, a lock on everything pauses the queues and jobs a lock interrupts fail cleanly or defer until it ends.
  - **Server helpers**: `getContentLockState`, `isContentLocked`, `useContentLock` for admin components, and typed translations.
