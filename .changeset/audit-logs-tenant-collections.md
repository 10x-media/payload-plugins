---
'@10x-media/audit-logs': minor
---

`multiTenancy.collections` names the tenant-scoped collections in the multi-tenant plugin's own shape, so one object configures both plugins. When set, only those collections and the tenants collection record a tenant, instead of any collection with a field named `tenantFieldName`. The tenant view's filters follow it: they offer only collections that can carry a tenant, no real globals, and `isGlobal` collections as globals.
