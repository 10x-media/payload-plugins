---
"@10x-media/analytics": minor
---

**Jobs, the read cache and reaching the sources.** The plugin's background work runs as Payload jobs under leases, reads are cached in a collection of their own, and every vendor source is reached through its own lane with retries and a circuit breaker, so one slow or failing source no longer holds up the others ([Caching](https://docs.10xmedia.de/analytics/cache), [Maintenance](https://docs.10xmedia.de/analytics/native#maintenance)).

**Upgrade actions**

1. Run Payload's job runner for the plugin's tasks, and let your scheduler call `/api/payload-jobs/run` through `jobs.access.run` ([Who may run jobs](https://docs.10xmedia.de/analytics/native#who-may-run-jobs)). `jobs: false` registers no task.
2. Move `sync.cron` to `jobs.tasks.sync.cron` and `cache.warm.cron` to `jobs.tasks.warm.cron`.
3. Where `payload_jobs` exists (1.0.0-beta.11 registered sync, warming or native retention), delete the queued runs of `analytics-prune-events` and `analytics-warm-cache` in the upgrade's migration, on Postgres before the task enum changes, with the statement the [upgrade page](https://docs.10xmedia.de/analytics/upgrading/beta-12#edits-before-you-run-it) gives; on MongoDB the predefined `drop-legacy-mongo` migration does it, so an install that ran warming without `native()` runs that migration too.
4. If a second auth collection queues or cancels your own jobs with `overrideAccess: false`, set `jobs.access` to allow it.
5. Remove the old cached reads from Payload's key-value store with `deleteLegacyCache({ payload })` from `@10x-media/analytics/migrations`; on MongoDB `dropLegacyNative` already does.
6. An install that keeps provider settings in a store of its own (`providers.resolve`) calls `refreshProviders()` when they change.
7. Code with an exhaustive `switch` over `AnalyticsErrorCode` or `QueryErrorCode` adds `rate_limited` and `source_misconfigured`.

**Breaking:** once the plugin registers a task, every job control your Payload config left unset admits only users of the admin collection: `jobs.access.run` (the `/run` and `/handle-schedules` endpoints), `jobs.access.queue`, `jobs.access.cancel`, the `payload-jobs` collection (composed over your `jobsCollectionOverrides`) and the `payload-jobs-stats` global. A control you set is never changed, and the boot says once which ones it restricted.

**Breaking:** the warm task is `analytics-warm`, no longer `analytics-warm-cache`, and it and `analytics-sync` follow `jobs.queue` and their own `jobs.tasks` entries. Warming replays the reads readers made recently, per scope, rather than the dashboard's default layout, and `cache.warm` takes `{ windowHours, maxReads }`. `jobs: false` refuses sync and warming at boot.

**Breaking:** reads are cached in the `analytics-cache` collection, or a `cache.store` of your own, instead of Payload's key-value store, and expired entries are deleted; live counts are kept in each instance's memory only. Cache keys changed, so every read reaches its source once after the upgrade.

**Breaking:** each vendor source has its own lane: 16 requests in flight across an instance's vendor sources and 4 per source by default (`cache.concurrency`), with retries, `Retry-After` capped at ten minutes and a circuit breaker. `rateLimit.maxConcurrent` is the size of a source's lane. A scope with too many reads waiting on their sources answers `429 rate_limited` with `Retry-After: 2` ([Reaching the sources](https://docs.10xmedia.de/analytics/cache#reaching-the-sources)).

**Breaking:** read errors carry what to do about them. A read the vendor refuses as asked (HTTP 400, 413, 414, 422, 431, gRPC invalid argument) answers `400 invalid_param` with `param: 'query'`, where it answered `503`; a refused key or property (HTTP 401, 403, 404), a credential that will not decrypt, or a provider host the install does not allow answers the new `502 source_misconfigured` with `param: 'source'` or `'host'`; the live endpoint answers `400` and `502` in the same cases. A native read the database refuses as written answers `400 invalid_param` too, a missing table, column or privilege `502 source_misconfigured`, and a statement timeout counts as a timeout. `AnalyticsErrorCode` gains `rate_limited` and `source_misconfigured` ([The codes](https://docs.10xmedia.de/analytics/reference/endpoints#the-codes)).

**Behavioral:** an expired entry is answered at once while it refreshes in the background (`meta.stale`), `meta.sourceError` says when the refresh failed because of how the source is set up, and `cache.timeoutMs` bounds only reads with nothing cached. `order` and `limit` are applied by the engine before an answer is cached, whatever the source sent, and a breakdown with a `limit` and no `order` is ranked by its first metric, highest first.

**Behavioral:** native reads have a lane of their own, outside `cache.concurrency`: 8 reads at once, or on Postgres a third of the host pool's `pool.max`, between 1 and 8. On a source every tenant shares (native, or a config adapter read per tenant), one tenant holds at most half of the lane, and the circuit breaker counts failures per tenant, so one tenant's failing reads do not stop the others'. A read SQLite refuses before it runs answers `503` and does not count toward the breaker.

**Behavioral:** each task runs at most four minutes per run and leaves the rest to the next one, under one lease per task in `analytics-state`, so two workers never do the same work. A killed run's lease lets the next run in within two minutes for sync and warming. On Cloudflare D1, where the plugin runs no SQL of its own, sync and warming hold their leases through Payload's database API one two-minute slot at a time, so a killed run frees its lease within four. An install with sync or warming but no `native()` gains the `analytics-state` collection for them, renamed through `jobs.state`.

**Behavioral:** sync reads as the system rather than a user, writes a metric the source did not report as `null`, and is not passed through `hooks.afterRead`, since it stores the source's own numbers.

**Behavioral:** the sources, goals, tracker config and ingest endpoints answer an unexpected failure with `500 internal` in the error envelope, where Payload answered with its own error, and log it (ingest at most once a minute); an `access.read` that throws is such a failure, and the refresh endpoint answers one with `500 internal` too, where it answered `503`. The capture proxy answers a bare `500` ([Which endpoint answers which](https://docs.10xmedia.de/analytics/reference/endpoints#which-endpoint-answers-which)).

**Behavioral:** on a local SQLite file, the read cache's writes and its sweep of expired entries queue behind the native engine's writes and are skipped while the host holds a transaction open in the same process, rather than waiting on the process's own lock until they fail; a skipped write only means the next read asks the source again ([Transactions on SQLite](https://docs.10xmedia.de/analytics/native#transactions-on-sqlite)).

**Behavioral:** what time it is comes from Payload's clock (`getCurrentDate`) for every day cut, lease and cache stamp on the server, so a test that sets that clock moves them together, and every duration, timeout, budget and rate limit runs on a monotonic clock that a jump of the wall clock does not stretch or cut. The boot's warnings (the job controls it restricted, spoofable addresses, packages loaded by name, a SQLite adapter's `transactionOptions`) wait for the server that serves requests: none prints while `next build` collects page data.

**Additive:** the `jobs` option (`queue`, and `queue` and `cron` per task, `false` to register none); `cache.store` (`CacheStore`), `cache.collection` and `cache.concurrency`; `hooks.afterRead` for observing or reshaping each read ([Observing reads](https://docs.10xmedia.de/analytics/cache#observing-reads)); `refreshProviders`; `ProviderHttpError` and `parseRetryAfter`; `TASK_NAMES`, `AnalyticsTaskName`, `ScheduledTask`, `AdapterJobs`; `CACHE_SLUG`, `STATE_SLUG` and `SYNC_SLUG`; `sync.collection.overrides`.
