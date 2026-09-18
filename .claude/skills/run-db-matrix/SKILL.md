---
name: run-db-matrix
description: Use when the user wants to run a single plugin's full Mongo + Postgres test matrix locally. Wraps `pnpm test:matrix <plugin>`.
---

# Run the DB matrix

1. Ask the user which plugin if not obvious from context.
2. Run: `pnpm test:matrix <slug>`. This runs the plugin twice, once with `DB_MATRIX=mongo` and once with `DB_MATRIX=postgres`. Mongo runs in-memory; Postgres runs in a real `postgres:16` container via testcontainers (Docker required). Coverage is decided in two places: the package's `test:matrix` script decides which spec files run in each lane, and each `describeForDb` block's `dbs` option decides which lanes that block joins. Most plugins' scripts name individual spec files (`grep -n '"test:matrix"' packages/*/package.json`), so a spec missing from that list is silently excluded from Postgres no matter how it is written; `analytics` is currently the only plugin whose script runs its whole `tests/int` directory on both lanes. A block pinned to one DB likewise runs only where the pin allows.
3. For both DBs in containers (max prod parity): `pnpm test:container <slug>`.
4. After tests complete, verify no leaked processes: `pnpm check:processes`. Kill with `pnpm clean:processes` if needed.
5. NEVER run `pnpm exec payload generate:*` or `pnpm exec payload migrate:*` directly to "regenerate types" or "set up the DB" as part of debugging; the bin script hangs. Use `pnpm generate <slug>` / `pnpm migrate <slug>` which route through `scripts/payload.sh` (120s deadline).
