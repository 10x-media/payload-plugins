---
'@10x-media/analytics': patch
---

Declare `maxmind` and `@payloadcms/db-postgres` as optional peer dependencies. Both are loaded lazily (maxmind by the MaxMind geo resolver, `@payloadcms/db-postgres` by the atomic rollup path on Postgres), but they were previously bundled into the published package, which inlined the entire Postgres driver stack and the MaxMind reader into dist. Consumers on Postgres already have `@payloadcms/db-postgres` installed; Mongo-only consumers never load it. Install `maxmind` only if you use the MaxMind geo resolver.
