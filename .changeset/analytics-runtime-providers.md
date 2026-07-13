---
"@10x-media/analytics": minor
---

Runtime provider configuration and multi-tenant scoping. New options: `scopeResolver` maps each request to an analytics boundary (tenant id, site key; null = whole install), `providers.collection` (false | true | object) scaffolds an admin collection where providers are configured at runtime per scope (masked secrets, overridable slug/fields/access, `scopeField` for tenant-plugin fields), `providers.resolve` replaces the collection lookup with a custom store, `platformAdapter` designates one config adapter shared by every scope, and `access.platformRead` gates cross-scope reads (default: any authenticated user). Scoped installs add an indexed scope column to native events and rollups (existing native installs need a migration), the posthog adapter gains `scopeProperty` for per-scope reads against one shared project, and `posthogProxyRewrites` (new `./next` subpath) returns Next.js rewrites for a first-party PostHog proxy.

```ts
import { getTenantFromCookie } from '@payloadcms/plugin-multi-tenant/utilities'

analytics({
  adapters: [native(), posthog({ projectId, apiKey, scopeProperty: 'tenant' })],
  platformAdapter: 'posthog',
  scopeResolver: ({ req }) => {
    const tenant = getTenantFromCookie(req.headers, req.payload.db.defaultIDType)
    return tenant === null ? null : String(tenant)
  },
  providers: { collection: { scopeField: 'tenant' } },
})
```

Static `adapters` config and default behavior without the new options are unchanged.
