---
'@10x-media/impersonation': patch
---

The tenant selector is now a plain `cookies.clearOnSwitch` entry. Swap start and exit expire it, and `@payloadcms/plugin-multi-tenant` selects the tenant itself; the impersonator's selection is no longer restored on exit. Parallel leaves every `clearOnSwitch` cookie in place. The default is `payload-tenant` regardless of `cookiePrefix`, matching the name the multi-tenant plugin hardcodes. The `impersonatorTenantCookie` field is removed from `impersonation-sessions`, so Postgres installs get a dropped column in their next migration.
