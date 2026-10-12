---
name: run-db-matrix
description: Use when the user wants to run a single plugin's full cross-database test matrix locally (Mongo + Postgres, and SQLite for analytics). Wraps `pnpm test:matrix <plugin>`.
---

# Run the DB matrix

1. Ask the user which plugin if not obvious from context.
2. Run: `pnpm test:matrix <slug>`. This runs the plugin once per lane its `test:matrix` script names: `DB_MATRIX=mongo` and `DB_MATRIX=postgres` everywhere, and for `analytics` also `DB_MATRIX=sqlite` twice, once with the native engine on worker threads (what a WAL file with a 5 s busy timeout gets) and once forced onto the main thread (`ANALYTICS_SQLITE_THREAD=main`). Mongo runs in-memory; Postgres runs in a real `postgres:16` container via testcontainers (Docker required; testcontainers needs `DOCKER_HOST` pointed at a Docker socket it cannot find on its own, such as OrbStack's); SQLite runs on a temp libsql file. Coverage is decided in two places: the package's `test:matrix` script decides which spec files run in each lane, and each `describeForDb` block's `dbs` option decides which lanes that block joins. Most plugins' scripts name individual spec files (`grep -n '"test:matrix"' packages/*/package.json`), so a spec missing from that list is silently excluded from Postgres no matter how it is written; `analytics` is currently the only plugin whose script runs its whole `tests/int` directory on every lane. A block pinned to one DB likewise runs only where the pin allows.
3. One lane alone, from the package directory: `DB_MATRIX=sqlite pnpm exec vitest run tests/int`. Analytics' config caps a Mongo lane at 3 workers and a Postgres lane at 4 and runs a SQLite lane in forked workers; pass `--maxWorkers=3` on another plugin's Mongo lane. Run one lane at a time.
4. For both DBs in containers (max prod parity): `pnpm test:container <slug>`.
5. After tests complete, verify no leaked processes: `pnpm check:processes` and `docker ps` (testcontainers leave a `ryuk` reaper behind for a few seconds). Kill with `pnpm clean:processes` if needed.
6. NEVER run `pnpm exec payload generate:*` or `pnpm exec payload migrate:*` directly to "regenerate types" or "set up the DB" as part of debugging; the bin script hangs. Use `pnpm generate <slug>` / `pnpm migrate <slug>` which route through `scripts/payload.sh` (120s deadline).
