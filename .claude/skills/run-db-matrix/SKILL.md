---
name: run-db-matrix
description: Use when the user wants to run a single plugin's full Mongo + Postgres test matrix locally. Wraps `pnpm test:matrix <plugin>`.
---

# Run the DB matrix

1. Ask the user which plugin if not obvious from context.
2. Run: `pnpm test:matrix <slug>`. This runs the plugin's int suite twice, once with `DB_MATRIX=mongo` and once with `DB_MATRIX=postgres`. Mongo runs in-memory; Postgres runs in a real `postgres:16` container via testcontainers (Docker required). A plugin that still pins specs to one DB runs only what that pin allows.
3. For both DBs in containers (max prod parity): `pnpm test:container <slug>`.
4. After tests complete, verify no leaked processes: `pnpm check:processes`. Kill with `pnpm clean:processes` if needed.
5. NEVER run `pnpm exec payload generate:*` or `pnpm exec payload migrate:*` directly to "regenerate types" or "set up the DB" as part of debugging; the bin script hangs. Use `pnpm generate <slug>` / `pnpm migrate <slug>` which route through `scripts/payload.sh` (120s deadline).
