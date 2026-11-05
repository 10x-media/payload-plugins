---
name: migrate
description: Use when the user wants to create, apply, or otherwise manage Payload migrations for a plugin in this monorepo.
---

# Payload migrations

Each plugin's dev app owns its own migrations at `packages/<slug>/dev/migrations/`. The dev `payload.config.ts` sets `db.migrationDir` accordingly.

## Standard flow

1. Add or change a collection in the plugin source.
2. Create a migration file: `pnpm migrate:create <slug> <migration-name>`. Example: `pnpm migrate:create automations add-jobs-table`.
3. Review the generated `.ts` file in `packages/<slug>/dev/migrations/`.
4. Apply: `pnpm migrate <slug>`.
5. Status check: `pnpm migrate:status <slug>`.

## Analytics: one chain per database and tenancy mode

`packages/analytics/dev/migrations/` holds `mongo`, `postgres`, `postgres-tenancy`, `sqlite` and `sqlite-tenancy`; `DEV_DB` and `TENANCY=on` pick the chain, and `next start` (the e2e suite) applies the SQL chains at boot through `prodMigrations`. A schema change needs a migration in each SQL chain: `DEV_DB=postgres TENANCY=on pnpm migrate:create analytics <name>` and so on. Payload's template imports `MigrateUpArgs`/`MigrateDownArgs` as values, which this repo's `verbatimModuleSyntax` keeps, so run `pnpm exec biome check --write dev/migrations` from the package afterwards (it rewrites them as type imports) before anything loads the file. `pnpm migrate:create analytics check --skip-empty` with the same variables creates nothing while a chain is current.

## Rollback / reset (use with care)

- `pnpm migrate:down <slug>` rolls back the last applied.
- `pnpm migrate:reset <slug>` rolls back all.
- `pnpm migrate:refresh <slug>` resets + reapplies.
- `pnpm migrate:fresh <slug>` drops tables + reapplies.

All routes through `scripts/payload.sh` (120s deadline; force-kills if the bin hangs after writing output).

## Never invoke directly

`.claude/settings.json` denies `pnpm exec payload migrate:*` to prevent the hang. Always use the short commands above.

## Before declaring done

Run `pnpm check:processes`. Migrations boot Payload and are the highest-risk command for leaving a hung bin process; confirm none was left behind.
