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
