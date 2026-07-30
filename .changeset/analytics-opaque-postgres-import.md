---
"@10x-media/analytics": patch
---

Make the rollup writer's Postgres import opaque to bundlers.

The optional `@payloadcms/db-postgres` peer was loaded via a literal dynamic import, which bundlers resolve at build time: a Mongo host on Turbopack fails `next build` with "Module not found" even though the Postgres branch never runs there (and `serverExternalPackages` does not help, since it governs bundling, not resolution). The specifier is now built at runtime, so no bundler resolves it and the package is only touched when the adapter is actually Postgres. Mongo hosts that worked around this with a resolve alias or stub can remove it.
