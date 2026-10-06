# @10x-media/content-lock

## 0.1.0-beta.2

### Patch Changes

- A kv store that rejects writes no longer locks everything, jobs deferred while the lock state cannot be read run again after a minute, and concurrent reads of the lock state share one read.

  - Fixed: a kv store that answers reads but rejects writes (Redis at `maxmemory` under `volatile-lru` rejects a SET without TTL) locked everything and paused every queue, because each read that rebuilt the snapshot failed although it had read the windows from the collection. Those windows are now enforced and the failed write is logged. Everything still locks while the lock state itself cannot be read. Saving or deleting a window still fails while its snapshot cannot be stored, so a save never reports a change that other servers do not see yet.
  - Fixed: a job that defers on interrupt and was stopped while the lock state could not be read waited a day, and nothing released it sooner, so a scheduled publish that ran into a kv outage went out a day late. It now runs again after a minute. Windows without an end still defer their jobs for a day, until **End now** releases them.
  - Concurrent reads of the lock state share one read per Payload instance. An admin page that resolves permissions for every collection makes one kv read instead of one per collection and operation, and a stale snapshot is rebuilt once instead of once per caller. A failed read is not kept: the next call reads again.

## 0.1.0-beta.1

### Minor Changes

- `assertContentUnlocked(req, target)` throws the lock's own `ContentLockedError` when a collection, global or custom target is frozen. Jobs that catch write errors per item, or pay for an external call before they write, call it first: the jobs integration then defers or fails them like a blocked write, before any work is done. It never throws for exempt targets, inside `withoutContentLock`, or with the plugin disabled. `isContentLocked` and the new helper share an exported `ContentLockTarget` type.

- `withoutContentLock(fn)` lets maintenance code write while a lock is active. Every Local API call in the callback's async chain, the hooks it fires included, runs as if nothing were locked; requests handled at the same time stay locked, and the banner, `isContentLocked` and paused queues still report the lock. Use it for the migrations and imports a lock exists to protect, never for request handlers or job runs.

### Patch Changes

- With the plugin disabled, `getContentLockState` and `isContentLocked` report nothing locked instead of throwing, so host code can call them in every environment.

- Groups and individual selection can name Payload's folders collection. Payload adds it after plugins run, so a group naming it failed the build with an unknown-collection error and the picker never offered it; locks on everything already froze it.

- A kv error while rebuilding the lock snapshot at startup is logged instead of failing the boot. Readers already rebuild a missing or stale snapshot and reject writes until they can, so enforcement is unchanged.

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/content-lock`: planned and unplanned maintenance windows that freeze Payload content.

  - **Windows**: a `content-locks` collection with drafts, derived stages (pending, announced, active, ended) shown as pills with list quick filters, optional announcement and end time, time zone pickers, Lock now and End now actions, and ended windows kept read-only as history.
  - **Enforcement**: a `beforeOperation` guard rejects create, update (autosave included), delete and restores with `ContentLockedError` (503, `Retry-After`) on REST, GraphQL, the admin and the Local API, including `overrideAccess: true`. Wrapped access renders the admin read-only in scope. State lives in a `payload.kv` snapshot and fails closed.
  - **Scope**: everything, configured groups, individual collections and globals (`individualSelection`), or custom targets that project code checks, with admin paths that scope the banner on custom views. `exempt`, collections marked `custom.contentLock.exempt`, and Payload's system collections stay writable.
  - **Banner**: one window at a time with a pager, active first, filtered to the current collection or global, announcements dismissible per user. Per-window localized messages with lock value tokens (start, end, announcement, scope, date) rendered live in the viewer's time zone, `localeMap` for admin language to content locale, and `editor.features` / `editor.converters` to extend the editor.
  - **Jobs**: with `@10x-media/jobs`, a lock on everything pauses the queues and jobs a lock interrupts fail cleanly or defer until it ends.
  - **Server helpers**: `getContentLockState`, `isContentLocked`, `useContentLock` for admin components, and typed translations.
