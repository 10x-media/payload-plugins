---
"@10x-media/form-builder": patch
---

Make the poll tally writer's Postgres import opaque to bundlers.

The optional `@payloadcms/db-postgres` peer was loaded via a literal dynamic import, which bundlers resolve at build time: a Mongo host on Turbopack failed `next build` with "Module not found" even though the Postgres branch never runs there (and `serverExternalPackages` does not help, since it governs bundling, not resolution). The specifier is now built at runtime, so no bundler resolves it and the package is only touched when the adapter is actually Postgres. Mongo hosts that worked around this with a resolve alias or stub can remove it.

Two upgrade notes from the same integrator round: hosts that had extended the select field block with their own `display` field must remove it on the beta.12 bump (the plugin ships one with identical values, and Payload refuses to boot with two same-name fields); and custom renderers replace the built-ins wholesale, so per-instance settings added in minor releases (`display` variants, `autocomplete`, calculation formatting) must be read by your renderer or an author's choice is silently ignored, now documented in the rendering guide.
