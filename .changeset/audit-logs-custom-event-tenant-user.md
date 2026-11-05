---
'@10x-media/audit-logs': minor
---

`createAuditEvent` takes a `tenant` and a `user`. `tenant` puts the entry in that tenant's view when `multiTenancy` is on, and is ignored with a warning when it is off. `user` attributes the event to someone other than `req.user`, for work a person started that runs in a job; `impersonator` is still read from `req`.

**Fixed: a custom event joins the group of the operation around it under a configured `logs.group.contextKey`.** Without an explicit `group` it read `req.context.auditGroup` whatever the key, while the automatic entries read the configured one.
