---
'@10x-media/audit-logs': minor
---

`logs.view.components.customEvents` renders custom events with your own components instead of the default table and JSON block. Keys are `eventType` values, `'*'` is the fallback and `false` keeps the default. Renderers run on the server with `payload` and `req`, receive `CustomEventComponentProps` (exported from `@10x-media/audit-logs/types`), and are registered in the import map by the plugin.
