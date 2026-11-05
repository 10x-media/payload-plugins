---
'@10x-media/audit-logs': minor
---

Store your own context on entries, render it in the view, and filter by it.

- Added: `logs.extend` adds fields to every entry before it is written, CRUD, auth and custom events alike. It runs inside the plugin's own write, so entries keep the direct database write that a hook in `logs.override` would turn off. A key the plugin sets itself (`user`, `diff`, `operation` and the rest) is ignored, so it cannot rewrite who acted or what changed.
- Added: view slots in `logs.view.components`. `user` is a popover on the user pill, opened from a chevron segment of its own, after the `impersonated` mark when there is one; `rowBadges` adds badges after the built-in ones; `beforeRowDetails` and `afterRowDetails` add sections to an expanded row; `beforeList` and `afterList` sit around the list. Server components also receive `payload`, `req` and `filterHref`, and every slot is registered under `config.admin.dependencies` for `generate:importmap`.
- Added: `logs.view.loadContext` runs once per page and hands its result to every slot as `context`, so a slot needs no query per row.
- Added: `useAuditLogRow` from `@10x-media/audit-logs/client` gives a client component in a row slot its entry and whether the row is expanded, so it can defer work until the row opens.
- Added: `logs.view.filters` declares filters over your own fields. A `relationship` filter is picked like the User filter (drawer or typed id), sits under More filters, lives in the URL as `?f.<name>=<id>` and matches with `in`, so text, hasMany text and relationship fields all work. The plugin refuses to start when a filter's `path` is not a field on the collection.
- New public types: `AuditLogUser`, `AuditLogRowState`, `AuditLogsRowSlotProps`, `AuditLogsListSlotProps`, `AuditLogsSlotServerProps`, `AuditLogsViewContext`, `ExtendEntryFunction`, `FilterHrefFunction`, `LoadViewContextFunction`, `RelationshipViewFilter` and `ViewFilter`.
