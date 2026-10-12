---
"@10x-media/analytics": minor
---

**Options: renamed options fail the boot, and the boot checks what it used to accept.** Every option is now checked when the plugin builds the Payload config, and a value of the wrong shape, a key no option takes at any level, an id that names no adapter, or a combination the plugin cannot honor stops the boot with a message naming the path ([Options](https://docs.10xmedia.de/analytics/reference/options)).

**Upgrade actions**

1. Load the config once (the dev server, or any `payload` command) and rename every option the error names, each listed with its replacement. The `native()` options fail first, in a message of their own, so it can take two runs. On an install without `scope.resolve`, remove `access.platformRead` and `scopes` instead: their replacements only apply to a scoped install, and there every cross-scope gate is `isAdminUser`.
2. Set `capture.gate` ([consent](https://docs.10xmedia.de/analytics/consent#which-slots-wait)) and, on a scoped install, `scope.member` ([multi-tenancy](https://docs.10xmedia.de/analytics/multi-tenancy)).
3. Set `revenue: true` or `revenue: { currency }` if the install reports revenue.
4. In `widgets.register`, replace `requires: { perPageQuery: true }` with `requires: { path: true }`, and `filterOperators` with `filters` naming each operator with its dimension.
5. Fix whatever else the boot refuses: the message names the option. With several invalid options, the one named first may differ from earlier releases.

**Breaking:** these 1.0.0-beta.11 options are removed, not deprecated, and fail the boot with an error naming the replacement and linking [Removed options](https://docs.10xmedia.de/analytics/upgrading#removed-options):

| Removed | Use instead |
|---|---|
| `scopeResolver` | `scope.resolve` |
| `scopes` | `scope.list` for the scopes the cron jobs run over, `scope.label` for the view caption, on a scoped install; remove it from an unscoped one |
| `access.platformRead` | `access.crossScope` (a function grants all three cross-scope gates) on a scoped install; remove it from an unscoped one |
| `capture.consent` | `capture.gate`: `'all'`, `'off'`, a list of slots, or `({ slot, adapterId, kind }) => boolean`; `({ kind }) => kind !== 'native'` reproduces the old default |
| `sync.collectionSlug` | `sync.collection.slug` |
| `sync.hidden` | `sync.collection.hidden` |
| `sync.cron` | `jobs.tasks.sync.cron` |
| `cache.warm.cron` | `jobs.tasks.warm.cron`; `cache.warm` keeps `windowHours` and `maxReads` |
| `goals.collection.enabled` | `goals.collection: false` |
| `native({ retentionDays })` | `native({ retention: { rawDays } })` |
| `native({ rollupRetentionDays })` | `native({ retention: { aggregateDays } })` |

**Breaking:** `adapters` is required in the option type. It may be empty only with `disabled: true`.

**Breaking:** a string `reportingTimezone` that is not a time zone fails the boot, where it used to read as UTC. A resolver answering one logs a warning once per value.

**Breaking:** options that only mean something on a scoped install fail the boot without `scope.resolve`: `scope.list`, `scope.label`, `scope.member`, `access.crossScope`, an adapter id in `capture.slots.tenant`, `capture.paths.tenant`, a `collections.<slug>.scopeField` other than `false`, and an explicit `goals.collection.scopeField` or `providers.collection.scopeField`.

**Breaking:** `disabled: true` checks every option and keeps the plugin's database schema, rather than returning the config untouched. A switched-off install therefore gains the plugin's collections: generate its migration as for a running one ([Switching it off](https://docs.10xmedia.de/analytics/reference/options#switching-it-off)).

**Breaking:** what 1.0.0-beta.11 let through now fails the boot: a key no option takes, at any level of the options (a misspelled `cache.tll` included); two adapters with the same `id`; a `cache.ttl` value that is not a whole number of seconds, 0 or more (`'300'` included); a `cache.timeoutMs`, `sync.lookbackDays`, `capture.proxy.timeoutMs` or `capture.proxy.maxBodyBytes` value that is not a whole number of at least 1; a `widgets.disabled` slug that names no widget of the install, and a `widgets.register` entry without its `slug`, `component` and `label`; `goals.collection` set to `null`, `0` or `''` (it takes `true`, `false` or an object); a `translations` key that is not one of the plugin's own, a key this release removed among them ([Translations](https://docs.10xmedia.de/analytics/reference/translations)).

**Breaking:** a `widgets.register` entry's `requires` takes only `metrics`, `dimensions`, `filters`, `realtime`, `perItemQuery` and `path`. The two 1.0.0-beta.11 keys that are gone fail the boot, naming their replacement, rather than being ignored and offering the widget where it was left out: `perPageQuery` is `path: true`, and `filterOperators` is `filters` naming each operator with its dimension, such as `filters: [{ dimension: 'page', operator: 'contains' }]` ([Custom widgets](https://docs.10xmedia.de/analytics/widgets#custom-widgets)).

**Breaking:** a collection override is checked against what the plugin reads and writes. An override may not rename a plugin collection (its `slug` option does), remove, rename or retype a field the plugin writes, drop an index it declares, add a required field without a fixed `defaultValue`, or turn off `timestamps` on the providers and goals collections; `overrides` must be a function, and on Postgres a table or index name over 63 characters fails. The checks run again at init against the config every plugin has assembled ([Renaming the plugin's collections](https://docs.10xmedia.de/analytics/reference/options#renaming-the-plugins-collections)).

**Breaking:** a goal path pattern holds at most 32 segments and four `**`; `**` inside a segment no longer crosses slashes (write `/docs/**` for any depth), and a path deeper than 128 segments matches nothing ([Path globs](https://docs.10xmedia.de/analytics/goals#path-globs)).

**Behavioral:** GA4's Data API client and `maxmind` are handed over through `sdks`, so a traced or standalone build ships them: `sdks: { ga4: { BetaAnalyticsDataClient }, maxmind: { open } }`. Without it the plugin still loads them by name, and a production boot warns.

**Additive:** options new since 1.0.0-beta.11, each covered by the entry for its theme: `routes.base`, `trustedPlatform`, `sdks`, `hooks.afterRead`, `jobs`, `revenue`, `scope`, `access.crossScope`, `capture.gate`, `capture.exclusion`, `capture.allowedOrigins`, `capture.skip`, `capture.autoCapture.items`, `collections.<slug>.scopeField` and `item`, `goals.purchase`, `goals.collection.fields`, `providers.collection.fields`, `connectionAccess` and `sourceAccess`, `providers.hosts`, `view.Component`, `widgets.overrides`, `countryFlags`, `cache.store`, `cache.collection`, `cache.concurrency`, `sync.collection.overrides`, and on `native()`: `retention`, `caps`, `collections`, `items`, `sqlite`, `today` and `buffer.maxPending`.
