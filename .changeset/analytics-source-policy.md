---
"@10x-media/analytics": minor
---

**Tenants can read the platform's shared source, and each tenant picks the source its readers open on.** On a scoped install, `sources` decides per shared config adapter whether a tenant's own members read their tenant through it, and `defaultSource` with the provider document's **Default for this site** checkbox decides a tenant's default source ([Letting tenants read a shared source](https://docs.10xmedia.de/analytics/multi-tenancy#letting-tenants-read-a-shared-source), [A tenant's default source](https://docs.10xmedia.de/analytics/multi-tenancy#a-tenants-default-source), [From 1.0.0-beta.12](https://docs.10xmedia.de/analytics/upgrading/beta-13)).

**Upgrade actions**

1. Check `access.crossScope` functions that query a database or a service: a gate may now be asked once per scope and adapter in a request, so keep it cheap or memoize it per request.
2. Keep a `named` gate able to answer from `{ req }` alone: the providers and goals collections still ask it without `scope`.

**Behavioral:** the `access.crossScope` gates are asked with `{ req, scope, adapterId }`: `named` with the scope a reader names, `aggregate` with `'*'` or `null`, `unscopedSource` with the tenant and the config adapter's id. A gate written for `{ req }` keeps working, but where 1.0.0-beta.12 asked it once per request it may now run once per scope and adapter.

**Behavioral:** a widget or a document panel whose stored data source its reader can no longer read reads the scope's default source and says so in a note, rather than failing. The query endpoint does not substitute: a `source` it cannot read still answers `404 unknown_source`.

**Additive:** `sources: { [adapterId]: { tenants } }`, with `tenants` one of `'staff'` (the default, what 1.0.0-beta.12 did), `'tenant'` (the tenant's members always read it, narrowed to their tenant), `'fallback'` (they read it until they read a source of their own) or `({ req, scope, adapterId, ownSources }) => boolean`. Anything but `'staff'` needs an adapter with `capabilities.scopedQueries`, or the boot fails naming `sources.<id>.tenants`. A policy never widens which scope a user reads: a tenant user still gets `400 untrusted_scope` for `scope=*` or another tenant. Jobs read as `SYSTEM` and ask no policy, and capture is unaffected.

**Additive:** under `'fallback'` the view and the providers list tell a tenant's users the numbers are the platform's until they add a source, and `GET /api/_x/sources` answers `notice: 'platformFallback'`. A provider save switches the next request to the tenant's own source.

**Additive:** `defaultSource: 'tenantFirst' | 'platformFirst' | ({ req, scope, sources }) => string | undefined`. A tenant's default is its document flagged **Default for this site**, then this rule, then what 1.0.0-beta.12 picked; the sources endpoint's `defaultId`, the view, widgets without a data source, the document panel, the read helpers and the warm task follow it. `sources` and `defaultSource` fail the boot without `scope.resolve`, and `'platformFirst'` without `platformAdapter`.

**Additive:** the types `AnalyticsSourceOptions`, `SourcePolicy`, `SourcePolicyFunction`, `OwnSource`, `SourceRef`, `DefaultSourceRule` and `DefaultSourceFunction`; `CrossScopeAccess` takes the optional `scope` and `adapterId`.
