---
"@10x-media/analytics": minor
---

**Upgrading from 1.0.0-beta.11.** This release rebuilds the native engine's storage, leaves consent to the site's consent manager, moves every endpoint under one base and tightens who may read what, so every install has edits to make, and every Postgres or SQLite install in migrate mode has one reviewed migration to run. The other entries of this release group the changes by theme; [From 1.0.0-beta.11](https://docs.10xmedia.de/analytics/upgrading/beta-12) is the whole procedure on one page, with every change and what to do about it.

**Upgrade actions**

1. Before the first boot, prepare a development database Payload pushes its schema to: on Postgres run the SQL under [Push mode](https://docs.10xmedia.de/analytics/upgrading/beta-12#push-mode), and start a pushed SQLite file again from a new one.
2. Upgrade `@10x-media/analytics` together with Payload `^3.83.0` (`payload`, `@payloadcms/next`, `@payloadcms/ui`) and `@10x-media/fields`, which is now a required peer ([Supported versions](https://docs.10xmedia.de/analytics/reference/stability#supported-versions)).
3. Load the config (the dev server, or any `payload` command) and fix what it refuses. A removed option fails it with an error naming its replacement, the `native()` options first and the plugin's own in a second message: rename each ([Removed options](https://docs.10xmedia.de/analytics/upgrading#removed-options)), but remove `access.platformRead` and `scopes` from an install without `scope.resolve`. The same checks refuse what 1.0.0-beta.11 let through, a translation override of a removed key among them, and a widget's `requires.perPageQuery` or `requires.filterOperators`, each named with its replacement.
4. Set `capture.gate`; `({ kind }) => kind !== 'native'` keeps what 1.0.0-beta.11 did by default. Where the gate holds native, server code that knows the visitor's answer passes `identity: 'request'` to keep server events on their visitor.
5. On a scoped install, add `scope.member`, and make `scope.resolve` answer the `capture` call site from the request's host.
6. If the install reports revenue, set `revenue: true` or `revenue: { currency }`, and give every goal that has an amount a currency.
7. Import `AnalyticsScripts` and `getTrackerConfig` from `@10x-media/analytics/site`, replace `consent()` calls with `setGate()`, and relay a vendor through a `captureRoute` route handler where `next.config` called `captureRewrites` or `posthogProxyRewrites`, which now throw.
8. Regenerate the import map (`pnpm payload generate:importmap`).
9. Migrate the database ([Storage and the database](https://docs.10xmedia.de/analytics/upgrading/beta-12#storage-and-the-database)):
   - **MongoDB:** `pnpm payload migrate:create analytics_storage --file @10x-media/analytics/migrations/drop-legacy-mongo`, then `pnpm payload migrate`, where the install ran `native()` or warming: without `native()` it drops nothing and still deletes the queued `analytics-warm-cache` runs.
   - **Postgres and SQLite in migrate mode:** `pnpm payload migrate:create analytics_storage`, answering **create table** (and **create enum** on Postgres) to every prompt, make the edits the upgrade page lists for your database, review the file, then `pnpm payload migrate`. Every such install needs it: the read cache is a new collection unless `cache.store` names a store of your own.
   - **A scoped install with the providers collection:** end that migration's `up` with an enabled `native` provider document for every tenant that keeps native analytics ([Scoped installs](https://docs.10xmedia.de/analytics/upgrading/beta-12#scoped-installs)).
10. Run Payload's job runner for `analytics-maintain`, and let your scheduler call it through `jobs.access.run`.
11. On Vercel or behind Cloudflare, set `trustedPlatform` in place of `trustedProxyHops`, which it excludes, to keep visitor countries.
12. List the origins of other sites whose pages post beacons in `capture.allowedOrigins`.
13. Turn on `capture.exclusion`, list your websites in `capture.exclusion.sites`, and have staff leave their browsers out from the analytics view's **Your own visits** panel.
14. List the self-hosted vendor hosts of your provider documents in `providers.hosts.allow`, and set `providers.hosts.allowPrivateNetwork: true` for one on `http://`.
15. On SQLite, open the database with `sqliteAdapter({ wal: true, busyTimeout: 5000 })` and leave `transactionOptions` unset; native runs on a database file, not an in-memory database or an embedded replica.

**Breaking:** the native engine's old storage is not converted. Its collections are dropped by the migration, and the native reports count from the first hit stored after the upgrade; export `analytics-events` and `analytics-rollups` first to keep their numbers ([Storage and the database](https://docs.10xmedia.de/analytics/upgrading/beta-12#storage-and-the-database)).

**Breaking:** `@10x-media/fields` is a required peer, where it was optional, whether the plugin runs or is switched off, and `react-datepicker` is no longer a peer: the custom range uses Payload's own date picker.

**Behavioral:** `@payloadcms/db-postgres` is no longer an optional peer: nothing in the package imports it.
