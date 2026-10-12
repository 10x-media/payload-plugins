---
"@10x-media/analytics": minor
---

**Multi-tenancy: one scope authority, membership checked on every read, and three cross-scope gates.** The host decides which tenant a request is for, through `scope.resolve`, and every surface reads that answer: the view, the widgets, the display fields, the endpoints and the read helpers. A reader must belong to the tenant they read, and reading past it takes an explicit gate ([Multi-tenancy](https://docs.10xmedia.de/analytics/multi-tenancy)).

**Upgrade actions**

1. Rename `scopeResolver` to `scope.resolve`, `scopes` to `scope.list` (and `scope.label` for the view caption), and `access.platformRead` to `access.crossScope`. An install without `scope.resolve` removes `scopes` and `access.platformRead` instead.
2. Add `scope.member`: `tenantMembership()` reads `@payloadcms/plugin-multi-tenant`'s tenants array, and `() => true` suits a resolver that already derives the scope from `req.user`.
3. Make `scope.resolve` answer a visit from its host when `callSite` is `'capture'`, never from the admin's tenant cookie, and never answer `'*'`: a beacon it resolves to no tenant is answered `202` and dropped.
4. Give every bound collection on a scoped install a `tenant` field, name another one in `collections.<slug>.scopeField`, or set `scopeField: false` to read the request's own scope.
5. With the providers collection, create an enabled provider document of type **Payload** (`provider: 'native'`) for every tenant that should keep native analytics, at the end of the upgrade migration's `up`, through its `req` and as a user `access.crossScope.named` admits ([Scoped installs](https://docs.10xmedia.de/analytics/upgrading/beta-12#scoped-installs)); and grant `access.crossScope.unscopedSource` to the readers who should still read a shared config adapter under a tenant.
6. Remove options that only mean something on a scoped install from an unscoped one.

**Breaking:** `scope.member` is required with `scope.resolve`. Every read refuses a tenant its user does not belong to, the read helpers of `/rsc` included, and a refused endpoint answers `400 untrusted_scope`.

**Breaking:** `scope.resolve` receives `{ req, callSite }`. At `capture` (beacons, the tracker config, the capture proxy, server tracking with a request) it is asked without the signed-in user, their cookies or their authorization header, and the timezone and currency resolvers get that same request there ([The call site](https://docs.10xmedia.de/analytics/multi-tenancy#the-call-site)). An answer of `'*'` is refused and logged: the wildcard is a reader's request, never a request's own scope. On a scoped install a request that resolves no tenant reads nothing unless the reader passes `access.crossScope.aggregate`.

**Breaking:** an install without `scope.resolve` has no scope to name: a read or a refresh naming one other than `*` answers `400 untrusted_scope`, where any signed-in user could name one. On every install a scope name over 256 characters is refused the same way.

**Breaking:** on a scoped install running the providers collection, native is granted per tenant by a `native` provider document. A tenant without an enabled one does not see the native source anywhere, gets no native beacon in its tracker config, and has its beacons dropped at ingest (still answering `202`); what it already stored is kept ([Native is a provider type](https://docs.10xmedia.de/analytics/multi-tenancy#native-is-a-provider-type)).

**Breaking:** with the providers collection, a tenant reads the sources its own provider documents grant it, filtered to the documents the reader may read (`providers.collection.sourceAccess`, by default the collection's own read access), and a config adapter only for a reader `access.crossScope.unscopedSource` admits; before, every config adapter that could narrow to a scope was readable by any tenant. On every scoped install, a config adapter that cannot narrow to a tenant is no longer among its sources at all, and naming it under a tenant answers `404 unknown_source` where it answered `403 forbidden` ([Which sources a request sees](https://docs.10xmedia.de/analytics/multi-tenancy#which-sources-a-request-sees)).

**Breaking:** a binding on a scoped install reads the document's own scope from `collections.<slug>.scopeField`, by default `'tenant'`, and the boot fails when the collection has no such field. The Analytics tab, the stat fields, the live counter and the document, sources and live endpoints all report the page's tenant rather than the reader's, and reading a document of another tenant takes `access.crossScope.named`; a reader it denies sees **Analytics for this page are not available to you** ([Whose numbers a document shows](https://docs.10xmedia.de/analytics/display-fields#whose-numbers-a-document-shows)).

**Behavioral:** `access.crossScope`, which replaces `access.platformRead` ([Removed options](https://docs.10xmedia.de/analytics/upgrading#removed-options)), is three gates: `named` (read a tenant you are not), `aggregate` (read every tenant at once) and `unscopedSource` (read a tenant through a config adapter rather than its own provider documents). A function grants all three, and the object form denies the gates it leaves out. On a scoped install every gate denies by default, as `platformRead` did; on an unscoped one each is `isAdminUser` and the option cannot be set ([Who sees what](https://docs.10xmedia.de/analytics/multi-tenancy#4-who-sees-what)).

**Behavioral:** naming your own resolved scope is no longer a cross-scope read, so it needs no gate; another tenant and `*` stay behind theirs.

**Behavioral:** a tenant capture slot left to its default takes the tenant's default source when that source captures, and otherwise the first of its sources that does, where it took the default source, and left the slot empty when that source could not capture.

**Behavioral:** the analytics view says whose numbers it shows: a reader who may aggregate gets a **Site** select offering their own site and **All sites** (`scope=*:<tenant>`), every other reader a caption naming the scope (`scope.label`), and a reader with no tenant selected is asked to choose one. A view address carrying any other `scope` is rewritten to the scope that answered.

**Behavioral:** `scope.resolve` at the `admin` call site, `reportingTimezone`, `revenue.currency` and the three cross-scope gates are each asked at most once per request, however many widgets and fields read on it.

**Additive:** `scope.label`, `tenantMembership()`; `ScopeCallSite`, `ScopeListResolver`, `ScopeLabelResolver`, `ScopeMemberAccess` and `CrossScopeAccess`; the panel's data-source switcher (`analyticsTab({ sources })`); the goals collection registered with `@payloadcms/plugin-multi-tenant` through `goals.collection.scopeField` ([Goals per tenant](https://docs.10xmedia.de/analytics/multi-tenancy#goals-per-tenant)).
