# Analytics: ICF multi-tenant / multi-provider backlog

Internal planning doc (not published to the docs site). Captures the work required to take
`@10x-media/analytics` from its current state to what ICF needs, plus a list of capability
ideas worth exploring before ICF adoption.

## ICF goal

- A **global platform adapter** that reports analytics across **all tenants** (one shared
  PostHog project, served through a first-party proxy like our other projects).
- **Tenants configure their own adapter at runtime** (their own PostHog project or another
  provider), through the admin UI, without a redeploy.
- **Multiple providers at once**: the platform adapter and per-tenant adapters coexist, and a
  tenant may run more than one provider.

## What already exists (foundations)

These are in place today and cover a large share of the goal:

- **Multi-adapter registry.** `createRegistry` (`packages/analytics/src/core/registry.ts`)
  holds an array of adapters; `isMultiProvider()` is true with more than one. Reads pick an
  adapter by explicit id (widget `dataSource`, field `adapter`) or fall back to
  `registry.default()`.
- **Runtime / DB-backed providers.** `providers.collection` registers an `analytics-providers`
  collection (`packages/analytics/src/providers/collection.ts`) where credentials are entered
  at runtime; `collectionProvidersSource` + `combineRegistries`
  (`packages/analytics/src/providers/resolver.ts`) layer those onto the static config per
  scope, with a 30s cache invalidated by collection hooks.
- **Scoping.** `scopeResolver` (`packages/analytics/src/core/options.ts`) maps a request to a
  tenant/site boundary; the native engine stamps a `scope` column at ingest, and PostHog's
  `scopeProperty` filters one shared project by a tenant property.
- **Platform adapter + cross-scope gating.** `platformAdapter` designates the shared adapter;
  `access.platformRead` gates cross-scope reads.
- **PostHog proxy.** `posthogProxyRewrites` (`packages/analytics/src/next/posthogProxyRewrites.ts`)
  provides the first-party client-capture proxy.

The intended ICF wiring is roughly:

```ts
analytics({
  adapters: [posthog({ /* platform project */, scopeProperty: 'tenant' })],
  platformAdapter: 'posthog',
  scopeResolver: ({ req }) => /* tenant id from cookie/header */,
  providers: { collection: { scopeField: 'tenant' } },
})
```

## Backlog items (with rationale)

### 1. Tenant self-service: access + auto-stamp on provider docs

`analytics-providers` has a hidden `scope` field (`providers/collection.ts`) but no per-tenant
access control and no automatic stamping. Today any logged-in user can read/write every
tenant's provider docs, and nothing sets `scope` on create.

- Add scoped `access` (read/create/update/delete constrained to the request's tenant).
- Add a `beforeChange` hook that stamps `scope`/`tenant` from the request so a tenant admin
  cannot create a provider for another tenant.
- Consider integration with Payload's multi-tenant plugin as an optional, documented path.

### 2. Encrypt provider secrets at rest

`providers/secrets.ts` only **masks** secrets on read (`__redacted__`); they are stored in
plaintext. For tenant-entered API keys this is insufficient.

- Encrypt secret fields at rest (Payload field-level encryption or an external secret store),
  decrypting only inside the adapter factory read (`PROVIDER_SECRET_REVEAL_CONTEXT`).

### 3. Scope-aware widget `dataSource` (+ per-source metric narrowing)

The widget `dataSource` select is built at plugin init from config-time adapters only
(`registerWidgets.ts`), so runtime/DB providers never appear, and its options do not vary by
tenant. Also, the metric select filters across the union of config adapters, not the selected
data source.

- Make `dataSource` options resolve per scope (include runtime providers for the tenant).
- Narrow the metric select to the chosen `dataSource`'s capabilities (needs a custom client
  field component; the union filter shipped in this pass is the coarse version).

### 4. Multiple providers of the same type per tenant

`adapterFromProviderDoc` (`providers/factory.ts`) assigns a fixed id per provider type
(`plausible`, `posthog`, ...), so two PostHog projects in one scope collide in the registry
Map and only one survives.

- Support instance ids (e.g. `posthog:<docId>`) so a tenant can run several projects of the
  same provider.

### 5. Native `hostname` dimension in rollups

Binding `hostname` now filters PostHog/GA4/Plausible queries, but the native engine ignores it:
its daily rollups are keyed by `path`/`scope` with no hostname dimension
(`packages/analytics/src/native/rollups/`), and raw events store hostname but querying them
per-document defeats the rollup design.

- Add `hostname` to the rollup key (ingest + rollup schema + a migration) so native honors the
  binding hostname for multi-domain installs. This completes the hostname story started this
  pass.

### 6. Extended PostHog coverage

PostHog now supports `pageviews`, `visitors`, `visits`, `sessions`, `events`, the `page` and
`event` dimensions, and hostname filtering. Still missing (all reachable via HogQL, none need
the Trends/Funnels REST endpoints):

- `bounceRate` / `avgDuration` via session-level HogQL (`sessions` table or `$session_duration`).
- `conversions` / `revenue` via event-name and revenue-property aggregation.
- Traffic/geo dimensions: `source`/`referrer` (`properties.$referrer`), `device`/`browser`/`os`
  (`properties.$device_type`, ...), `country`/`region`/`city` (`properties.$geoip_*`).
- A PostHog `realtime()` implementation (would flip `capabilities.realtime` and add a realtime
  window read).

Each needs verification against a real PostHog project's schema before shipping.

### 7. Document PostHog proxy wiring for ICF

Confirm and document the split between the client-capture proxy
(`posthogProxyRewrites`, `@10x-media/analytics/next`) and the server-side Query API adapter
(`@10x-media/analytics/adapters/posthog`), so ICF wires both correctly (proxy for capture,
personal API key with Query Read scope for reads).

## Capability ideas to explore before ICF adoption

- **`AnalyticsQuery.filters`.** The contract defines `filters` (`core/contract.ts`) but no
  adapter implements it. Wiring it into HogQL/GA4/Plausible WHERE clauses would enable
  event-name and property filtering beyond the fixed dimensions.
- **Comparison / period-over-period.** `capabilities.comparison` is `false` everywhere; a
  previous-period read would enable trend deltas in widgets and stat fields.
- **Sub-day granularity.** `minGranularity` is `day` for all adapters; HogQL/GA4 could support
  hourly for realtime-adjacent views.
- **Per-tenant sync fan-out.** The sync task resolves scope from the job `req` only
  (`sync/syncTask.ts`); multi-tenant installs need per-tenant job fan-out to persist each
  tenant's daily metrics.
