---
"@10x-media/analytics": minor
---

**Security: one endpoint base, admin-only defaults, and public endpoints that trust nothing a request merely claims.** Reads default to the admin collection's users, capture never sees the admin's identity, provider documents connect only where the install allows, and the links and refs a page can send are signed ([Endpoints](https://docs.10xmedia.de/analytics/reference/endpoints)).

**Upgrade actions**

1. Update code, CDN rules or Next routes of your own that call the old `/api/analytics/*` paths (table below), and build the paths with `analyticsRoutes(config)`. A page that boots with `initTracker({ endpoint })` passes the new config path.
2. Give a second auth collection that should read analytics an `access.read` of your own, and widen the goals, sync or providers collection's `access` where users outside the admin collection manage them.
3. Resolve a visit's scope from its host at the `capture` call site, never from the admin's tenant cookie ([The call site](https://docs.10xmedia.de/analytics/multi-tenancy#the-call-site)).
4. On Vercel or behind Cloudflare, set `trustedPlatform: 'vercel'` or `'cloudflare'` in place of `trustedProxyHops`, which it excludes, or visitor countries stop being read ([Which headers to trust](https://docs.10xmedia.de/analytics/geo#which-headers-to-trust)).
5. List your other sites whose pages post beacons in `capture.allowedOrigins`.
6. List the self-hosted vendor hosts of your provider documents in `providers.hosts.allow`, and set `providers.hosts.allowPrivateNetwork: true` for a host on `http://` ([Where a document may connect](https://docs.10xmedia.de/analytics/providers#where-a-document-may-connect)).
7. Turn the exclusion link on with `capture.exclusion: true` and hand staff the link the analytics view gives them ([Excluding your own visits](https://docs.10xmedia.de/analytics/capture#excluding-your-own-visits)).
8. Where `next.config` calls `captureRewrites` or `posthogProxyRewrites`, relay the vendor through `captureRoute` in a route handler instead, or leave `capture.paths` unset to use the plugin's own proxy ([First-party proxy](https://docs.10xmedia.de/analytics/proxy)).

**Breaking:** every endpoint moved under one base, `routes.base`, default `/_x`, with no alias at the old paths:

| 1.0.0-beta.11 | Now |
|---|---|
| `GET /api/analytics/query`, `/sources`, `/goals`, `/document` | `GET /api/_x/query`, `/sources`, `/goals`, `/document` |
| `POST /api/analytics/refresh` | `POST /api/_x/refresh` |
| `GET /api/analytics/realtime` | `GET /api/_x/live` |
| `POST /api/analytics/ingest` | `POST /api/_x/e` |
| `GET /api/analytics/tracker` | `GET /api/_x/config` |
| `/api/analytics/p/:slot/*` | `/api/_x/p/:slot/:path*` |

`native({ ingestPath })` and `capture.paths` default to the new paths, and the tracker and the admin build them themselves. The boot refuses a base whose first segment a collection slug, a plain-object name or an earlier root endpoint would take ([Where the endpoints answer](https://docs.10xmedia.de/analytics/reference/endpoints#where-the-endpoints-answer)).

**Breaking:** `access.read` defaults to the users of the admin collection (`admin.user`), where any signed-in user read before, and the read helpers of `/rsc` are gated by it too; so does every cross-scope gate on an install without `scope.resolve`. The goals, sync and providers collections admit only the admin collection's users by default, and reading the sync collection also takes `access.read`.

**Breaking:** a `POST` another site's page makes a visitor's browser send (`Sec-Fetch-Site`) is dropped by ingest, still answering `202`, and refused by the capture proxy with `403`, unless its origin is in `capture.allowedOrigins` ([Beacons from other sites](https://docs.10xmedia.de/analytics/capture#beacons-from-other-sites)). On a scoped install the same holds for a page on a sibling subdomain whose host `scope.resolve` maps to another tenant than the request's.

**Breaking:** `captureRewrites` and `posthogProxyRewrites` from `@10x-media/analytics/next` throw when called, and are `@deprecated`: a Next rewrite to a vendor forwards every request header, the visitor's cookies and the site's `payload-token` among them, and passes the vendor's `set-cookie` back to the site. Relay the vendor through `captureRoute` instead ([First-party proxy](https://docs.10xmedia.de/analytics/proxy)).

**Breaking:** a provider document's `host` must be an `https` address. An adapter built from a document connects only to public addresses and follows no redirect on its own, and a self-hosted host the install does not list fails as `502 source_misconfigured` and captures nothing. `providers.hosts.allowPrivateNetwork: true` admits private addresses, and `http://` hosts in `providers.hosts.allow` and in the document's `host` field, which are refused without it ([Private networks](https://docs.10xmedia.de/analytics/providers#private-networks)).

**Breaking:** on a scoped install a provider document's connection (its type, host and the ids its adapter reads) changes only with `access.crossScope.named`, and any change of where a document connects clears its stored key, so enter the key again in the same save ([Changing where a document connects](https://docs.10xmedia.de/analytics/providers#changing-where-a-document-connects)). A stored credential is decrypted on a request of its own, outside the reader's transaction, and taking a beacon never decrypts one; a document whose credential does not decrypt lists as a failing source.

**Breaking:** the exclusion link is off by default and signed: `?analytics_exclude=1` no longer excludes a browser, and the tracker's `exclusionParam` option and `readExclusionParam` are gone. With `capture.exclusion: true` the parameter carries an HMAC of the scope keyed by the Payload secret, the tracker config carries only its hash, and `capture.exclusion.param` renames it. A browser already excluded stays excluded.

**Breaking:** on Vercel and Cloudflare the visitor's country, region and city come from the platform's headers only with `trustedPlatform` set; without it no platform header is read. `trustedPlatform` and `trustedProxyHops` exclude each other.

**Breaking:** the capture proxy decides each answer's content type from its route's `kind`, sends `X-Content-Type-Options: nosniff` and sandboxes data answers; a custom adapter declares `kind` on every proxy route.

**Behavioral:** the tracker sends native only the referrer's origin and, of the page's query string, only the campaign keys (the `utm_*` keys and the names of the click ids), and `props.url` on `outbound_link` and `file_download` drops the query string, the fragment and any credentials.

**Behavioral:** the capture proxy answers `404` for a path segment holding an encoded `/` or `\`, which an upstream would read as a separator, and `405` with an `Allow` header for a `POST` to a script route. A Plausible `scriptId` that is not up to 64 letters, digits, `_` and `-` renders no snippet, and the providers collection refuses it.

**Behavioral:** the document endpoint refuses a range over 366 days with `400 range_too_long`, as the query endpoint does, and both refuse a date before 1970 with `400 invalid_param`. The analytics view names goals and the scope only to a reader `access.read` admits, even where `access.view` is wider.

**Behavioral:** nothing a vendor snippet embeds can end its `<script>` element: every value every adapter writes into an inline script goes through one escaper, `</script>` and the JavaScript line separators included.

**Additive:** `captureRoute` and `CaptureRouteOptions` from `@10x-media/analytics/next`, a route handler that relays one adapter's vendor by the capture proxy's rules: no cookie or credential upstream, and no `set-cookie` back; `routes.base`, `analyticsRoutes`, `routePaths` and `DEFAULT_ROUTE_BASE`; `isAdminUser`; `trustedPlatform`; `capture.allowedOrigins`; `capture.exclusion` with `param` and `sites`, and `GET /api/_x/exclusion` behind the view's **Your own visits** panel; `providers.hosts`; `createGuardedFetch`, `resolveHostPolicy` and `CONNECTION_PATHS`, all `@beta`; `providers.collection.connectionAccess` and `sourceAccess`; item refs and order ids signed by the server (`signItemRef`, `itemAttributesFor`, `signOrderId`).
