---
'@10x-media/audit-logs': minor
---

Record the impersonator on an audit entry when the acting user was reached through impersonation. The list names the acting user and shows who was impersonating them.

The `impersonator` field is added only when `@10x-media/impersonation` is installed. `impersonation: false` keeps it out, `impersonation: true` adds it without the plugin.
