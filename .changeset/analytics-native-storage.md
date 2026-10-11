---
"@10x-media/analytics": minor
---

**Native engine: raw hits counted into daily totals, with real visits, on MongoDB, Postgres and SQLite.** The engine stores one row per hit, counts each closed day into exact daily totals per scope, hostname and value, and answers a read from the totals of closed days and the raw hits of today, of hours and of filtered reads. Visits are counted from the hits, so bounce rate and time per visit are real ([Native engine](https://docs.10xmedia.de/analytics/native)).

**Upgrade actions**

1. Export `analytics-events` and `analytics-rollups` first if you want to keep their numbers: the old storage is not converted.
2. On a development database Payload pushes its schema to, before the first boot: on Postgres run `DELETE FROM payload_jobs WHERE task_slug::text IN ('analytics-prune-events', 'analytics-warm-cache');` when `payload_jobs` exists, then `DROP TABLE analytics_events, analytics_rollups, analytics_seen CASCADE;` and `DROP TYPE enum_analytics_events_type;`, and the push does the rest; start a pushed SQLite file again from a new one ([Push mode](https://docs.10xmedia.de/analytics/upgrading/beta-12#push-mode)).
3. Run the migration for your database ([Storage and the database](https://docs.10xmedia.de/analytics/upgrading/beta-12#storage-and-the-database)):
   - **MongoDB:** `pnpm payload migrate:create analytics_storage --file @10x-media/analytics/migrations/drop-legacy-mongo`, then `pnpm payload migrate`. It drops the old collections and deletes the old salts, the old cached reads and the queued runs of the retired tasks.
   - **Postgres in migrate mode:** generate it with `pnpm payload migrate:create analytics_storage`, answering **create table** and **create enum** at every prompt, then edit it:
     - add `IF EXISTS` to the three `DROP CONSTRAINT` statements on `payload_locked_documents_rels`;
     - when `payload_jobs` exists, which it does once 1.0.0-beta.11 registered any task (sync, warming or native retention), make `DELETE FROM "payload_jobs" WHERE "task_slug"::text IN ('analytics-prune-events', 'analytics-warm-cache');` the first statement of its `db.execute` block: it deletes the queued runs of the two retired task names, and the cast keeps it valid on a task enum that lacks either label;
     - with the providers collection, move its `ALTER TYPE ... ADD VALUE 'native'` out of `db.execute` and run it on the adapter's own connection, outside the migration's transaction.
   - **SQLite in migrate mode:** generate it the same way, then move the three `DROP TABLE` statements below the rebuild of `payload_locked_documents_rels`, with the providers collection remove `"ga4_currency"` and `"posthog_scope_property"` from both column lists of `INSERT INTO __new_analytics_providers`, and when `payload_jobs` existed before the upgrade end `up` with `DELETE FROM payload_jobs WHERE task_slug IN ('analytics-prune-events', 'analytics-warm-cache');`.
   - On Postgres and SQLite, end `up` with `deleteLegacySalts({ payload })`, and optionally `deleteLegacyCache({ payload })`, from `@10x-media/analytics/migrations`; on a scoped install with the providers collection, each tenant's `native` provider document follows them in the same `up`.
4. Replace `native({ retentionDays, rollupRetentionDays })` with `native({ retention: { rawDays, aggregateDays } })`, and pass the Payload instance to `NativeAdapter.flush(payload)`.
5. Run a jobs runner for `analytics-maintain`, or set `jobs: false` to leave the upkeep to reads and ingest.
6. On SQLite, open the database with `sqliteAdapter({ wal: true, busyTimeout: 5000 })` so the engine runs on worker threads, and leave `transactionOptions` unset. Run native on a database file: it refuses an in-memory database and an embedded replica.
7. On Postgres, size the host pool (`postgresAdapter({ pool: { max } })`) with the engine's share in mind: its long reads and counts take at most a third of it ([Production note (Postgres)](https://docs.10xmedia.de/analytics/native#production-note-postgres)).

**Breaking:** `analytics-events`, `analytics-rollups` and `analytics-seen` are replaced by `analytics-hits` (one row per hit), `analytics-aggregates` (daily totals) and `analytics-state` (salts, day markers, leases and heartbeats). The new collections are hidden, have no REST or GraphQL endpoints, and take text ids the engine makes. The daily salts move from Payload's key-value store to `analytics-state` and each is deleted once the third UTC day after its own begins.

**Breaking:** native needs MongoDB 5.0, Postgres 12 or SQLite 3.35 or later, and refuses Cloudflare D1 at boot; keep a D1 install on vendor adapters. On SQLite it opens a connection of its own to the database file, so an in-memory database, an embedded replica or a second copy of libsql stops it (`502 source_misconfigured`, warned once). MongoDB-compatible services (Amazon DocumentDB, Azure Cosmos DB, Firestore) are not supported, and below MongoDB 5.0 reads and counts refuse while hits are still stored.

**Breaking:** raw hits are kept 90 days by default and daily totals for every day. Filtered and hourly reads, which read raw hits, reach back as far as `retention.rawDays`; a sale's and a refund's rows outlive it as tombstones without their visitor, until their day's totals go ([Retention](https://docs.10xmedia.de/analytics/native#retention)).

**Breaking:** `native()` registers the `analytics-maintain` task (every 15 minutes), which turns Payload's jobs on for an install that had none; `analytics-prune-events` is gone ([Maintenance](https://docs.10xmedia.de/analytics/native#maintenance)).

**Breaking:** `NativeAdapter.flush(payload)` takes the Payload instance it writes for, since every engine structure is kept per instance.

**Breaking:** server events never join the host's transaction: a rolled-back order keeps its hit, and on SQLite one tracked inside an open transaction is written once it ends. A server event without `req`, `ip` or `userAgent` belongs to no visitor, and `event.timezone` only picks the day of its salt ([Server events and host transactions](https://docs.10xmedia.de/analytics/native#server-events-and-host-transactions)).

**Behavioral:** a visit is a visitor's hits on one hostname with no gap over 30 minutes, attributed to the pageview that opened it; hour series are the reporting timezone's local hours; breakdowns list no `(other)` row; a referrer is stored only on the pageview that opened a visit, engagement rows carry no visitor attributes, and a click id is stored by name, never its value.

**Behavioral:** native reads say what their numbers are: `meta.partial` (days not counted yet), `meta.capped` (values folded away, whose raw hits are gone), `meta.failed` (days whose counting was given up), `meta.clamped` with `dataFrom` and `dataTo` (an end of the range past the raw hits kept), `meta.asOf` (today's snapshot), `meta.visitorsAre` and `meta.timezoneUnresolved`. Native never sets `meta.sampled`.

**Behavioral:** daily totals keep at most 10,000 pages and 100 currencies per hostname a day, with the other caps of `native({ caps })`; what a day sends beyond a cap stays exact while its raw hits are kept and is folded into one row after that ([Daily totals and caps](https://docs.10xmedia.de/analytics/native#daily-totals-and-caps)).

**Behavioral:** maintenance counts days that are waiting first, oldest first, then works through the scopes in turn from a saved cursor, skipping a scope with no new hits since its last pass. A day whose count fails three times is marked failed: reads use an earlier count of it when there is one, and `rebuildDays` counts it again ([Maintenance](https://docs.10xmedia.de/analytics/native#maintenance)).

**Behavioral:** today is read live from its raw hits up to 5,000 hits on Postgres and 2,000 elsewhere, and above that from a snapshot taken in the background, served for one to five minutes by how busy the day is (`meta.asOf`). A read spends at most three seconds on closed days it finds uncounted and never starts one it cannot finish; a day left out is counted in `meta.partial.missingDays` and the read is cached for the realtime TTL. A read whose window reaches into today is cached 10 seconds at most, whatever `cache.ttl` says, and read again rather than served stale once it expires ([TTLs](https://docs.10xmedia.de/analytics/cache#ttls)).

**Behavioral:** on Postgres the engine shares the host's pool: its long reads, counts and analytical transactions hold at most a third of `pool.max` connections, all its work at most one fewer than the pool, so the host always keeps one; a count a read starts carries a `statement_timeout` (on MongoDB a shared `maxTimeMS`). Each call the engine makes to a host resolver gets a fresh local request.

**Behavioral:** a live read fails as a whole, `503` with `Retry-After`, when any part of it fails. A write buffer batch that fails as a whole (a lock, a lost connection) is retried once after 500 ms and then dropped; only a batch a row of which was refused is retried row by row.

**Behavioral:** on a local SQLite file the engine runs its statements on three worker threads of its own when the database is in WAL mode with a busy timeout of at least 5,000 ms, so counting a busy day no longer freezes the process; otherwise it stays on the main thread under stall budgets and the boot warns once. `native({ sqlite: { thread } })` or `ANALYTICS_SQLITE_THREAD` sets it ([SQLite](https://docs.10xmedia.de/analytics/native#sqlite)).

**Behavioral:** the boot warns when a local SQLite file's adapter sets `transactionOptions`. `@libsql/client` 0.14 opens every connection after a transaction without the adapter's busy timeout, so from the second transaction on a write fails at once with `SQLITE_BUSY` while another connection holds the lock (the engine's, a jobs worker's, another instance's), and libsql may then lose later writes on that connection. Leave `transactionOptions` unset, as Payload does by default ([Transactions on SQLite](https://docs.10xmedia.de/analytics/native#transactions-on-sqlite)).

**Behavioral:** the public ingest path reads nothing from the database per beacon. Buffered and deferred hits are written on `SIGINT` as on `SIGTERM`, and `process.exit()` logs how many were lost.

**Behavioral:** a `geoResolver` that throws, or answers something other than text for a field, has the event stored without a location instead of failing the beacon, and is logged at most once an hour.

**Additive:** `native({ retention, caps, collections, items, sqlite, today })` and `buffer.maxPending`; `meta.failed` and `meta.dataTo` on a read's result; native filters with `matches` on Postgres and MongoDB, for patterns that JavaScript, Postgres and MongoDB read alike (no nested quantified groups), any other answering `400 invalid_param` with `param: 'filters'`; `rebuildDays`, `NativeAdapter.rebuild` and the maintain task's `rebuild` input count a stretch of days again ([Rebuilding days](https://docs.10xmedia.de/analytics/native#rebuilding-days)); `dropLegacyNative`, `deleteLegacySalts` and `deleteLegacyCache` from `@10x-media/analytics/migrations`; `HITS_SLUG`, `AGGREGATES_SLUG`, `MAINTAIN_TASK_SLUG` and `SESSION_DIMENSIONS` from `/adapters/native`; `ingestRoute` and `ingestPreflight` from `/next`, for taking beacons in a route of your own.
