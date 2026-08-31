---
'@10x-media/audit-logs': minor
---

`payloadAPI` accepts values Payload core never defines.

- Fixed: a value outside `REST`, `GraphQL` and `local` failed the log write with `payloadAPI: 'MCP' is not a valid enum value`, and the audited operation failed with it. `@payloadcms/plugin-mcp` sets `req.payloadAPI = 'MCP'` on every request it serves. The field is now `text` instead of `select`, and any value is recorded without configuration.
- Added: `logs.payloadAPIs` labels the values a project expects, on top of the three core sets. A bare string is its own label; an entry naming a built-in relabels it in place. It drives the badge in the logs view only, never validation, so an undeclared value still renders, as its raw string.
- Postgres hosts need one migration for the column type; the enum values cast to text unchanged, so no data moves. Mongo needs none.
