---
"@10x-media/analytics": minor
---

A native event is attributed to the request that carried it, not to the hostname its body claims.

**Breaking:** the hostname a native event is stored under is now the host the request carried (`x-forwarded-host` where `trustedProxyHops >= 1`, else `Host`, lowercased, port stripped, capped at 253), and the body's claim is ignored. `Origin` is never read: a scripted client can pair a valid `Host` with any `Origin` and mint unlimited hostname bucket families inside one scope, which is the hole this closes. An install whose beacons already post from the site they are counting sees no change, because the request's host is the page's host; an install whose tracker posts to a different host than the page runs on sees its stored hostname change, and should use the new `hostname` resolver form.

**Breaking:** on an install with a `scopeResolver`, an event whose request resolves no scope is dropped instead of being stored install-wide, unless its resolved hostname is listed in the native adapter's `platformHostnames`. A dropped event answers exactly what an accepted one answers, `202` with `{ ok: true }`, with nothing logged, so the endpoint is no oracle for which hosts or tenants exist. A misconfigured resolver is therefore silent: if events stop arriving, check it before the tracker.

**Breaking:** the ingest body's `hostname` is optional, and a body carrying one is only type-checked. A missing `hostname` no longer answers `400`; a non-string one still does. `trackServerEvent` is unaffected and still requires its own, since trusted server code has no request to attribute an event to.

**Additive:** `native({ hostname })` takes `'request'` (the default), a list of hostnames (the request host is stored only when the list holds it, and this is the form to use on a single-site install with no `scopeResolver` and no edge validating `Host`), or a resolver `({ claimed, req, scope }) => string | null` that decides per event, where `null` drops it and a throw drops it too. List entries are validated at boot: a scheme or a port in an entry, or an empty list, fails the boot rather than silently dropping every event.

**Additive:** `native({ platformHostnames })` names the platform's own domains on a scoped install, which ingest under the null scope rather than being dropped. The list is static on purpose: those domains change with a deploy, not with a signup. Tenant domains never belong in it, because a tenant's custom domain is tracked the moment its document is saved, through the install's own `scopeResolver`.

**Additive:** `analytics({ trustedProxyHops })` sets how many proxies in front of the app are trusted, counted from the right of `x-forwarded-for`. It is plugin-level because one helper reads the client address for the native visitor hash, for geo, and for the capture proxy's upstream `X-Forwarded-For`. Unset keeps today's leftmost entry, which is correct for honest traffic and client-writable otherwise. At `n >= 1` the forwarded chain is the only source, and a chain shorter than `n` yields no address rather than falling back to the client-writable `x-real-ip`. There is no default of `1`: an install behind a CDN plus a proxy would then read the CDN's address for every visitor, collapsing geo and the visitor hash onto one value.

**Additive:** `GeoResolver` gained an optional second argument carrying `trustedProxyHops`, so a resolver that does its own IP lookup reads the same address the rest of the pipeline does. `maxmindResolver` honors it. A one-argument resolver still type-checks and still runs.

**Behavioral:** an existing single-site install sees the same hostname it saw before in the common same-origin case, since the request's host is the page's host there. The visitor hash and the same-site referral check both key off the resolved hostname rather than the claimed one, so a forged body no longer splits one visitor across hostname buckets. The salt, timezone and goal resolvers now run only for an event that will be kept.

Rate limiting is deliberately not part of this. The plugin decides what one accepted request may write; how many requests are accepted belongs to the edge, where a per-IP limit can throttle an abuser instead of the whole install's traffic.
