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

# Docs showcase clips (clipwright; needs `pnpm dev <name>` running on :3000)
pnpm videos <name>                      # render packages/<name>/videos/*.video.ts

# Generation (manual; agent contexts skip auto-gen via env var, see below)
pnpm generate <name>                         # regenerate types + importmap for one plugin
pnpm generate:types <name>
pnpm generate:importmap <name>

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
pnpm check:template                     # template/package parity for verbatim-shared files

# Scaffolding + release
pnpm new                                # scaffold a new plugin (interactive)
pnpm changeset                          # author a changeset

# Process hygiene
pnpm check:processes                    # dry-run stale-process scan
pnpm clean:processes                    # kill them
```

`<name>` is a plugin directory under `packages/` (e.g. `automations`) or an app under `apps/` (e.g. `docs`, so `pnpm dev docs` and `pnpm build docs` work). `scripts/run.ts` runs cacheable tasks (`build`/`lint`/`typecheck`/`test*`) through turbo and routes `dev`/`start`/`generate*`/`migrate*` to a plugin's `-dev` package via pnpm; apps have no `-dev` companion and do not support `generate`/`migrate`. Unknown names get a "Did you mean: ..." suggestion.

Migrations live at `packages/<plugin>/dev/migrations/`. Each plugin's `dev/payload.config.ts` sets `db.migrationDir` accordingly. Use `pnpm migrate:create <plugin> <migration-name>` in real projects, exactly mirroring Payload v3's standard workflow.

### Worktree dev servers

`pnpm dev <name>` run from a git worktree derives a stable, unique port from the worktree directory name (band 4100-4999) and prints it with the URL; the primary checkout keeps :3000 and the `.claude/launch.json` 31xx ports. Agents: follow the `worktree-dev` skill. In short: run `PAYLOAD_SKIP_AUTOGEN=1 pnpm dev <name>` in the background from the worktree, attach the browser via `preview_start` with the printed URL (never a launch.json name, which boots the primary checkout's code), and never add worktree entries to the primary's launch.json.

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

### Bundle isolation gates (`test:dist`)

Only `@10x-media/fields` defines a `test:dist` script, but the turbo task declares `dependsOn: ["build"]`, and turbo schedules that dependency in every package that lacks the parent task. `pnpm test:dist` therefore runs **eleven `next build`s** (ten dev apps plus `apps/docs`) alongside the one real gate. Check the fan-out before you change it:

```bash
pnpm exec turbo run test:dist --dry=json
```

Unbounded that peaked at 67 node processes and more than 16 GB on a 4-vCPU CI runner, which swapped the runner to death and surfaced as a `build` job cancelled with no error at all. CI caps it with `--concurrency=3`. Keep that cap, and keep every `packages/*/dev/helpers/memoryDb.ts` returning its placeholder URI under `NEXT_PHASE === 'phase-production-build'` so no dev app spawns a mongod while collecting page data. `tooling/plugin-template` carries the same file and `pnpm check:template` fails if they diverge, so edit the template first and copy it over the packages.

Unfiltered `pnpm build` has the same eleven-way fan-out. The short commands forward extra args to the task rather than to turbo, so cap it with the env var instead: `TURBO_CONCURRENCY=3 pnpm build`.

## Affected scoping in CI

`ci.yml` does not run the whole workspace on every push. Each of `lint`, `typecheck`, `build`, `test`, and `test-matrix` starts with a `scope` step (`scripts/ci-affected.sh`) that resolves the git range into `TURBO_SCM_BASE`/`TURBO_SCM_HEAD` and emits `steps.scope.outputs.flag`, which is either `--affected` or empty. The turbo invocation interpolates that flag, so an empty one means the job runs everything.

The base comes from the workflow-level `AFFECTED_BASE_SHA`: a pull request's base sha, a push's `before` sha, empty otherwise. Every job needs `fetch-depth: 0`; a shallow checkout has no base commit and takes the fallback.

Scoping is by **package graph**, never by directory. A change to `jobs` also selects `automations`, because `automations` depends on it. `--filter` and `--affected` intersect rather than union, so `build` stays `--filter='./packages/*'` and simply narrows within it.

**What forces the whole workspace**, and this is the part to keep intact when editing any of it:

- A path in `globalDependencies` (`config/**`, `tsconfig.json`, `biome.json`, `.npmrc`, the root `package.json`, `pnpm-workspace.yaml`). Turbo fans those out to all 29 packages. The root manifest and the catalog are in that list *specifically* for this: without them a Payload bump in `pnpm-workspace.yaml`'s `catalog:` selects no packages at all and CI passes having tested nothing.
- A change under `.github/` or `scripts/`, which `ci-affected.sh` special-cases. Those are not a build input of any package, so turbo cannot see them, and a pull request that rewrites CI would otherwise go green having run nothing.
- `workflow_dispatch`, a first push to a branch, or a base commit that force-push removed.

Verify a scoping change with `turbo ls`, which applies the filter without hashing (`--dry=json` also works but re-hashes the workspace, which is slow on Windows when a global dependency changed):

```bash
pnpm exec turbo ls --filter='...[<base>...<head>]'
```

`check:dist` runs as `--only-built`, skipping packages an affected build deliberately left without a `dist/`. `check:template` and `check:registry` stay unscoped: template drift is exactly the class of bug that hides in the packages a scoped run skips.

Two consequences worth knowing. `main` keeps `cancel-in-progress: true`, so if a push cancels an in-flight run, the next run only covers its own commits rather than re-testing the backlog; the cancelled changes were still covered by their own pull request. And the `test` job's Mongo pre-cache step runs even when nothing is affected, so a docs-only pull request still pays for that download.

## Docs showcase clips

A plugin may carry `packages/<slug>/videos/*.video.ts`: clipwright scenes driving that plugin's own dev app, rendered to MP4 for the docs site. They are showcases rather than tutorials, so they carry no captions and no audio, and the docs play them muted and looping through `<Video>` (`apps/docs/components/video.tsx`).

`pnpm videos <name>` renders them, and needs `pnpm dev <name>` already serving on `:3000` (override with `WIKI_DEV_URL`). Output goes straight into `apps/docs/public/videos/<slug>/`, one MP4 plus a poster PNG per scene, and those files are committed. Nothing renders them in CI: they are binaries in git, so re-render only when the UI they show actually changed.

Scenes are linted and typechecked with the rest of the package. Whatever fixtures a scene needs it creates through the REST API in `beforeScene`, which is off camera and free.

## Adding a plugin

1. `pnpm new`: interactive prompt for slug and description.
2. `pnpm install`: link the new workspace package.
3. Implement the plugin in `packages/<slug>/src/`.
4. Add tests in `packages/<slug>/tests/int/` (or co-located `src/**/*.test.ts` for units).
5. `pnpm test <slug>`: verify smoke tests pass.
6. `pnpm changeset`: record the release entry.

### Template parity

Most of `tooling/plugin-template` is a starting point each plugin rewrites, but a few files are meant to stay byte-identical everywhere: the Payload route and layout boilerplate, `dev/next.config.ts`, `dev/helpers/memoryDb.ts`, `src/plugin/registerTranslations.ts` and `src/translations/useTranslation.ts`. `pnpm check:template` enforces that list (`TRACKED` in `scripts/check-template.ts`) and runs in the `lint` job.

The template is copied once at `pnpm new` and never consulted again, so a fix applied only to the generated packages never reaches it. That is how the `memoryDb.ts` production-build guard diverged for six weeks while four plugins were scaffolded without it. **Edit the template first, then copy it over the packages.** A long-lived branch that scaffolds a new plugin will go red here after any tracked file changes on `main`; rebasing and recopying the template is the fix.

Tracked files are compared byte for byte, so they cannot contain `{{placeholder}}` tokens; the check says so explicitly if one appears.

## Release flow

The repo is in beta pre-mode. The flow is currently split, because the npm account is `auth-and-writes` 2FA and pnpm 10 has no OIDC, so CI cannot publish:

1. `release.yml` opens or updates a "Version Packages" PR aggregating queued changesets. It no longer publishes.
2. Merge that PR, then publish each bumped package from `main` with `pnpm publish:plugin <name>` (interactive passkey). The script publishes to npm and pushes the `@10x-media/<name>@<version>` tag.
3. The tag push triggers `release-notes.yml`, which creates the per-package GitHub release from its `CHANGELOG.md`.

Planned: move to pnpm 11 + npm OIDC trusted publishing so CI publishes and releases again (restore the `publish:` step in `release.yml`). To exit beta: `pnpm changeset pre exit` and add a major-bump changeset for each package going stable.

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

**Manual regeneration / migrations.** The user-facing short commands (`pnpm generate <name>`, `pnpm migrate <name>`, `pnpm migrate:create <name> <migration-name>`, etc.) all route through `scripts/payload.sh`, which:

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
