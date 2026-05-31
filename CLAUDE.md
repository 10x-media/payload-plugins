# 10x-media Payload plugins, Claude Code guide

This is a Turborepo of public `@10x-media/*` Payload v3 plugins maintained by 10x Media GmbH. See `CONTRIBUTING.md` for the contributor workflow, plugin anatomy, and release flow.

**Toolchain:** Node 22.18+ and pnpm 10 for development; every package declares `engines.node >=22.18.0` (22.18 is the floor for Node's native `.ts` support, which the vitest configs rely on). Docker is required for the Postgres, container, and e2e test tiers. Shared dependency versions are centralized in a pnpm `catalog:` in `pnpm-workspace.yaml`, so a Payload or React bump is a one-line change. Cacheable tasks (build, lint, typecheck, test) run through Turborepo.

## Layout

- `packages/<slug>/`: published plugins (`@10x-media/<slug>`)
- `packages/<slug>/dev/`: nested Next app per plugin (`@10x-media/<slug>-dev`, private)
- `tooling/<name>/`: private internal packages (test-harness, plugin-template)
- `config/<name>/`: shared configs (typescript, biome, vitest)
- `apps/docs/`: fumadocs documentation site
- `scripts/`: repo-level utilities (`run.ts` command router, `gen-plugin.ts` scaffolder, `payload.sh` payload bin wrapper, `cleanup.sh` stale-process killer)

## Rules (always-on)

These rules live in `.cursor/rules/*.mdc` and apply to all work in this repo. Both Claude Code and Cursor pick them up.

- **Comment policy** (`comments.mdc`): default no comment. JSDoc encouraged on anything meaningful, not just public exports. No em-dashes anywhere, no low-signal filler comments, no banner art.
- **Post-task audit** (`post-task-audit.mdc`): before declaring any change "done", sweep comments, check stale references, align docs, verify process hygiene, run lint and typecheck and the relevant tests. Drift is debt.
- **Process hygiene** (`process-hygiene.mdc`): `pnpm check:processes` before declaring done. Payload's auto-generate hang is documented there.
- **Monorepo conventions** (`monorepo-conventions.mdc`): pnpm only, workspace short names, scope discipline.
- **Plugin shape** (`plugin-shape.mdc`): every plugin in `packages/` follows the same factory and exports shape.

## Command surface

Short, positional commands. Pass a plugin's short name to scope to that plugin; omit it to fan out across the workspace. No `--filter` boilerplate, ever.

```bash
pnpm install                            # standard pnpm

# Build
pnpm build                              # build all packages
pnpm build <name>                       # build one plugin (e.g. automations)

# Dev / start
pnpm dev <name>                         # boot a plugin's dev server (next dev)
pnpm start <name>                       # start a built dev app (next start)

# Tests (tiered, Payload-aligned)
pnpm test                               # all tests, all packages (Mongo in-memory, fast)
pnpm test <name>                        # one plugin's full test suite
pnpm test:unit [name]                   # src/**/*.test.ts (co-located with source)
pnpm test:int [name]                    # tests/int/**/*.int.spec.ts (Mongo in-memory)
pnpm test:matrix [name]                 # cross-DB run; Mongo in-memory + Postgres via testcontainers (Docker)
pnpm test:container [name]              # both DBs via testcontainers (Mongo container + Postgres container)
pnpm test:e2e <name>                    # docker compose + build + Playwright

# Generation (manual; agent contexts skip auto-gen via env var, see below)
pnpm gen <name>                         # regenerate types + importmap for one plugin
pnpm gen:types <name>
pnpm gen:importmap <name>

# Migrations (Payload's standard CLI, routed through scripts/payload.sh)
pnpm migrate <name>                              # apply pending migrations
pnpm migrate:create <name> <migration-name>      # generate a new migration file
pnpm migrate:status <name>                       # show applied + pending
pnpm migrate:down <name>                         # roll back last migration
pnpm migrate:refresh <name>                      # down all + apply all
pnpm migrate:reset <name>                        # down all
pnpm migrate:fresh <name>                        # drop tables + apply all

# Quality
pnpm lint [name] / pnpm lint:fix [name]
pnpm typecheck [name]
pnpm format

# Scaffolding + release
pnpm new                                # scaffold a new plugin (interactive)
pnpm changeset                          # author a changeset

# Process hygiene
pnpm check:processes                    # dry-run stale-process scan
pnpm clean:processes                    # kill them
```

`<name>` is a plugin directory under `packages/` (e.g. `automations`) or an app under `apps/` (e.g. `docs`, so `pnpm dev docs` and `pnpm build docs` work). `scripts/run.ts` runs cacheable tasks (`build`/`lint`/`typecheck`/`test*`) through turbo and routes `dev`/`start`/`gen*`/`migrate*` to a plugin's `-dev` package via pnpm; apps have no `-dev` companion and do not support `gen`/`migrate`. Unknown names get a "Did you mean: ..." suggestion.

Migrations live at `packages/<plugin>/dev/migrations/`. Each plugin's `dev/payload.config.ts` sets `db.migrationDir` accordingly. Use `pnpm migrate:create <plugin> <migration-name>` in real projects, exactly mirroring Payload v3's standard workflow.

## Test tiers (Payload-aligned)

Modeled after Payload's own monorepo test pattern: Mongo runs in-memory via `mongodb-memory-server` (matches Payload exactly); Postgres always runs in a real container via `testcontainers` (`postgres:16`). There is intentionally **no in-process Postgres** option; Payload's tests use real Postgres in Docker and we follow that pattern.

| Tier | When | Command |
|---|---|---|
| Unit | Pure functions, no DB; co-located `src/**/*.test.ts` | `pnpm test:unit [name]` |
| Int (Mongo) | Single-DB integration, fast (MongoMemoryReplSet) | `pnpm test:int [name]` |
| Int (matrix) | Cross-DB run for the same suite (Mongo in-memory + Postgres in container) | `pnpm test:matrix [name]` |
| Int (full container) | Both DBs containerized (max prod parity) | `pnpm test:container [name]` |
| E2E | Production build + Playwright + docker compose | `pnpm test:e2e <name>` |

Postgres-touching tiers (matrix, container, e2e) require Docker locally and on CI. This mirrors Payload's own monorepo test pattern (Mongo in-memory, Postgres in real Docker).

## Adding a plugin

1. `pnpm new`: interactive prompt for slug and description.
2. `pnpm install`: link the new workspace package.
3. Implement the plugin in `packages/<slug>/src/`.
4. Add tests in `packages/<slug>/tests/int/` (or co-located `src/**/*.test.ts` for units).
5. `pnpm test <slug>`: verify smoke tests pass.
6. `pnpm changeset`: record the release entry.

## Release flow

The repo is in beta pre-mode. Every merge to `main` triggers:

1. `release.yml` opens or updates a "Version Packages" PR aggregating queued changesets.
2. Merging that PR runs `changeset publish` (via `pnpm release`) with npm provenance and creates per-package GitHub releases.

To exit beta: `pnpm changeset pre exit` and add a major-bump changeset for each package going stable.

## Process hygiene

The test harness boots Mongo in-memory via `mongodb-memory-server` (matches Payload's own pattern). Postgres always runs in a real container via `testcontainers`. All adapters register `afterAll` cleanup. E2E uses docker compose with a `trap` to tear down on exit. Before declaring any task complete, run `pnpm check:processes` and `docker ps` to confirm no leaked processes or containers.

### Payload bin hang (`generate:*` and `migrate:*`)

Payload v3's bin commands (`generate:*`, `migrate:*`) often write their output successfully but the node process refuses to exit (Mongoose holds the event loop open; the bin script doesn't call `process.exit(0)`). For `generate:*` it's worse: `payload.init()` and `payload.reload()` auto-spawn `void payload.bin(...)` whenever `NODE_ENV !== 'production'` AND the per-config `autoGenerate` flag isn't false; every `getPayload({ config })` call leaks one. Symptom: `node ...payload/bin.js <command>` pinned at ~98% CPU.

**Conditional fix.** Each plugin's `dev/payload.config.ts` reads `PAYLOAD_SKIP_AUTOGEN`:

```ts
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

export default buildConfig({
  // ...
  typescript: { autoGenerate },
  admin: { importMap: { autoGenerate, baseDir: ... } },
})
```

- **You, running `pnpm dev automations` locally:** no env var, `autoGenerate: true`, Payload auto-generates types and importMap on HMR like normal. Standard Payload DX preserved.
- **Agent contexts:** `.claude/settings.json` sets `PAYLOAD_SKIP_AUTOGEN=1`, `autoGenerate: false`, zero auto-spawned subprocesses, no leaks.
- **CI:** workflows that run tests can set `PAYLOAD_SKIP_AUTOGEN=1` for the same reason.

**Test harness** (`tooling/test-harness/src/bootPayload.ts`) hardcodes both flags to `false` regardless of env. Tests never need generated output and should never spawn generate subprocesses.

**Manual regeneration / migrations.** The user-facing short commands (`pnpm gen <name>`, `pnpm migrate <name>`, `pnpm migrate:create <name> <migration-name>`, etc.) all route through `scripts/payload.sh`, which:

- Enforces a 120-second deadline (override via `PAYLOAD_CMD_DEADLINE=N`)
- Force-kills the child + node subprocesses if exceeded
- Exit code 124 means the deadline tripped (output file is still written)

**Belt-and-suspenders.** `.claude/settings.json` denies direct `pnpm exec payload generate:*` and `pnpm exec payload migrate:*` (and equivalents) at the agent-permission layer. With auto-generation off in agent contexts and the deny rule blocking ad-hoc invocations, the failure mode is structurally impossible for an agent to trigger.

**Cleanup if it ever leaks anyway:**

```bash
pnpm check:processes      # dry-run: list stale repo-owned processes
pnpm clean:processes      # kill them
```

`cleanup.sh` only matches processes whose command line includes this repo's path. It will never kill the host's system `mongod`, your Cursor/VSCode, or other projects' processes.
