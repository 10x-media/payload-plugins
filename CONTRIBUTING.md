# Contributing to @10x-media/payload-plugins

## Prerequisites

- Node 22.18+ (the floor for native `.ts` config support; `.nvmrc` pins the line, run `nvm use` or `fnm use`)
- pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- Docker (required for `test:matrix`, `test:container`, and `test:e2e` tiers)

The Node target lives in `.nvmrc`, `engines.node` (root and each published package), and `.github/workflows/ci.yml` (`env.NODE_VERSION` plus the `test` matrix). To move to the next LTS, bump all of those together.

## Install

```bash
pnpm install
```

## Commands

```bash
# Build
pnpm build              # all packages
pnpm build <name>       # one plugin

# Quality
pnpm lint [name]
pnpm lint:fix [name]
pnpm typecheck [name]
pnpm format
pnpm api:check          # API reports match the built declarations (build first), docs entry points pages match the reports
pnpm api:update         # rewrite the API reports, then the docs entry points pages, after an intended change
pnpm docs:check         # docs internal links, and the analytics docs' code examples type-checked

# Tests (see tiers below)
pnpm test               # all packages, Mongo in-memory
pnpm test <name>        # one plugin (analytics runs its ~30 s clock pass first; test:unit skips it)
pnpm test:unit [name]
pnpm test:int [name]
pnpm test:matrix [name]
pnpm test:container [name]
pnpm test:e2e <name>
E2E_DBS=postgres pnpm test:e2e analytics   # analytics e2e on some databases (default: mongo postgres sqlite)
pnpm test:upgrade analytics                # upgrade 1.0.0-beta.11 installs (UPGRADE_DBS, UPGRADE_VARIANTS select)

# Docs showcase clips (needs `pnpm dev <name>` already running)
pnpm videos <name>
```

`<name>` is the directory name under `packages/` (e.g. `automations`).

### Generated types and migrations

`pnpm generate:types <name>` and `pnpm migrate:create <name> <migration-name>` both load the dev app's `payload.config.ts`, so what they produce follows whichever config branch that file takes from the environment (a plugin dev app may switch databases or turn tenancy on through variables). Each run of `generate:types` rewrites the dev app's `payload-types.ts` from scratch, so run the variant whose types you want to keep last. `migrate:*` keeps `PAYLOAD_SKIP_AUTOGEN=1` in `scripts/payload.sh`: Payload's init would otherwise start `generate:types` in the background and rewrite `payload-types.ts` as a side effect of creating a migration.

### The analytics dev app's database

`pnpm dev analytics` picks its database from `DEV_DB`:

| `DEV_DB` | Database |
|---|---|
| unset or `mongo` | MongoDB in memory, or `DATABASE_URI_MONGO` |
| `postgres` | `DATABASE_URI_POSTGRES`, else the e2e container's `postgres://e2e:e2e@localhost:35432/analytics_e2e` |
| `sqlite` | a libsql file under `packages/analytics/dev/.sqlite/` (gitignored), or `DATABASE_URI_SQLITE`, in WAL mode with a 5 s busy timeout, so the native engine runs its statements on worker threads |

Postgres and SQLite push their schema in development. `TENANCY=on` switches to the multi-tenant config, and on SQLite to a file of its own.

`next start`, which the e2e suite runs, is production, where Payload never pushes a schema: on Postgres and SQLite the dev app applies its committed migrations at boot instead (`prodMigrations`), one chain per database and tenancy mode under `dev/migrations/` (`postgres`, `postgres-tenancy`, `sqlite`, `sqlite-tenancy`). A change to the dev config or the plugin that alters the schema needs a migration in each chain it reaches: `DEV_DB=sqlite TENANCY=on pnpm migrate:create analytics <name>`, and the same for the other three. `pnpm migrate:create analytics check --skip-empty` with the same variables creates nothing while a chain is current.

## Test tiers

| Tier | When | Docker? | Command |
|---|---|---|---|
| Unit | Pure functions, no DB; co-located `src/**/*.test.ts` | No | `pnpm test:unit [name]` |
| Int (Mongo) | Integration, fast (MongoMemoryReplSet) | No | `pnpm test:int [name]` |
| Int (matrix) | Cross-DB: Mongo in-memory + Postgres container (+ SQLite file for `analytics`, twice: the native engine on worker threads, then on the main thread with `ANALYTICS_SQLITE_THREAD=main`) | Yes | `pnpm test:matrix [name]` |
| Int (container) | Both DBs containerized | Yes | `pnpm test:container [name]` |
| E2E | Production build + Playwright + docker compose | Yes | `pnpm test:e2e <name>` |
| Upgrade (`analytics`) | A 1.0.0-beta.11 install upgraded the way the upgrading page says | Yes | `pnpm test:upgrade analytics` |

There is no in-process Postgres option. Postgres tiers always use a real Docker container (`postgres:16` via testcontainers). SQLite needs no Docker: each boot opens its own libsql file in a temp directory.

The analytics e2e suite builds the dev app once and runs it on every database in `E2E_DBS` (default `mongo postgres sqlite`), each in both tenancy modes, then once more with `ANALYTICS_SLOW_SOURCE_MS=10000`, where the in-memory source answers 10 s late and is the default, for the checks that an edit view and the dashboard never wait on a source. Its lifecycle checks (a tab covered by another, a page left, a prerendered page) drive a Chromium the suite starts itself in the new headless mode, since Chromium refuses to prerender for a page a DevTools client is attached to and Playwright's focus emulation keeps every page it drives visible.

The upgrade test (`packages/analytics/scripts/upgrade.sh`) checks the `@10x-media/analytics@1.0.0-beta.11` tag out into a temporary worktree and, for each install shape in `UPGRADE_VARIANTS` (`tasks`: retention, warming and sync; `none`; `sync` alone, whose task enum lacks the retired tasks; `scoped`: multi-tenant, each tenant given a `native` provider document), migrates a fresh database with that release and ingests through its endpoint, then upgrades on this tree: `migrate:create` answering "create" to every prompt, the upgrading page's edits applied by `tests/upgrade/editMigration.ts` (which fails when a statement the page names is missing), `migrate`, `migrate:status` all run, `migrate:create --skip-empty` creating nothing, and reads through the new endpoints. MongoDB takes the `drop-legacy-mongo` predefined migration instead. It removes the worktree, its migrations and its containers on exit, however it ends. It installs that release's dependencies, so it needs the npm registry or a pnpm store that already holds them.

A separate workflow (`.github/workflows/payload-latest.yml`) runs the analytics unit tests and its Mongo int lane against the newest Payload 3.x every week and on demand.

## Parallel development and worktrees

Everything is safe to run in parallel across multiple git worktrees, with no per-worktree setup:

- **Tests** (unit, int, matrix, container) bind ephemeral ports: testcontainers let the OS assign a free host port per container, and in-memory Mongo picks a random port. Each worktree has its own `node_modules`, and the turbo cache is content-hashed, so concurrent runs never collide.
- **e2e self-isolates.** `scripts/e2e.sh` derives both its `COMPOSE_PROJECT_NAME` and its host ports (Mongo/Postgres/Next) from the worktree, so two worktrees can run e2e at once untouched. Pin them with `MONGO_E2E_PORT` / `PG_E2E_PORT` / `E2E_NEXT_PORT` if you ever need fixed ports. The analytics upgrade test takes a compose project and ports of its own the same way (`MONGO_UPGRADE_PORT` / `PG_UPGRADE_PORT`), so it can run beside an e2e run of the same worktree.
- **Dev server.** `pnpm dev <name>` defaults to port 3000 (`${PORT:-3000}`); set `PORT` to run a second dev server from another worktree.

## Writing tests

Integration tests use the `@10x-media/payload-test-harness` helpers:

- `bootPayload({ plugin, db, seed?, collections?, configOverrides?, attachTo?, disableOnInit? })`: boots a real Payload instance on the given DB (`'mongo'`, `'postgres'` or `'sqlite'`) and returns `{ payload, db, connectionString, stop }`. SQLite runs on a temp libsql file with WAL and a 5 s busy timeout, and without transactions, as Payload's SQLite adapter does by default; `sqliteTestAdapter` (from `@10x-media/payload-test-harness/db/sqlite`, for a boot that sets `transactionOptions`) keeps that timeout on every connection a libsql transaction hands over, where libsql itself opens them without it. `attachTo` boots a second instance on an existing boot's database (the same file on SQLite); `disableOnInit` skips every `onInit`, the way a jobs worker boots. Always call `stop()` in `afterAll`.
- `describeForDb(name, { dbs? }, (db) => { ... })`: runs the block once per DB. Omit `dbs` to honor the `DB_MATRIX` env (comma-separated `mongo`, `postgres`, `sqlite`; defaults to Mongo; an unknown name fails the run). Two separate things decide what a cross-DB run covers: the package's own `test:matrix` (or `test:container`) script decides **which spec files** run in each lane, and each block's `dbs` option decides **which lanes that block joins**. Most plugins' scripts still name individual spec files, so a spec left out of that list is silently excluded from Postgres however it is written; `@10x-media/analytics` is currently the only plugin whose script runs its whole `tests/int` directory on every lane, SQLite included. A `dbs` pin also overrides the env, so a block pinned to `['mongo']` never runs on Postgres: pin only what is genuinely single-DB, say why in a comment, and add new specs to the script's file list when the script uses one.
- A suite that boots Payload many times can share one Postgres server across the whole run instead of starting a container per boot: start `startSharedPostgresServer()` from a vitest `globalSetup` and publish its URL on `PAYLOAD_TEST_POSTGRES_SERVER` (see `packages/analytics/tests/setup/sharedPostgres.ts`). Each boot then takes its own database on it. Cap that lane's workers as well (`@10x-media/analytics` sets `maxWorkers: 4` on its int project whenever `DB_MATRIX` names postgres, and 3 for mongo): a many-core machine otherwise boots enough Payloads at once to push the one shared server into recovery mode, which fails specs that changed nothing.
- A plugin whose background work outlives a request registers `onRelease((payload) => ...)` from a vitest setup file; the harness awaits it (15 s at most) before every `payload.destroy()`, so nothing is still running against the database when a test file's worker ends. Run a SQLite lane in forked workers (`pool: 'forks'`): vitest ends a worker thread with `terminate()`, and libsql aborts the whole run when that lands mid-statement.
- `expectForDb(db, { postgres: x }, fallback)` and `skipForDb(...)`: assert or skip per adapter when behavior legitimately differs (for example, Mongo lacks native cascade deletes). Name only the adapters that differ; the fallback covers the rest.

## Adding a plugin

1. `pnpm new`: interactive prompt for slug and description.
2. `pnpm install`: link the new workspace package.
3. Implement the plugin in `packages/<slug>/src/`.
4. Add tests in `packages/<slug>/tests/int/` (or co-located `src/**/*.test.ts` for units).
5. `pnpm test <slug>`: verify tests pass.
6. `pnpm changeset`: record the release entry.

## Plugin anatomy

Every plugin in `packages/<slug>/` follows the same shape (`packages/automations` is the worked example):

- `src/index.ts`: the plugin factory. Use a **named export** returning a Payload `Plugin`: `export const myPlugin = (options: MyPluginOptions = {}): Plugin => (config) => config`. Do not default-export an arrow function (a lint rule enforces this).
- `src/exports/`: public sub-path entry points wired through the package `exports` map: `.` (factory), `./types`, `./client` (client/React-only code), `./i18n`. Server code must not import from `./exports/client`.
- `src/translations/`: i18n. Keys live in `translations/keys.ts` as a typed constant; look them up with `t(keys.someKey)`, never a string literal.
- `dev/`: a private, per-plugin Next.js app (`@10x-media/<slug>-dev`) that mounts Payload admin so you can exercise the plugin by hand (`pnpm dev <slug>`) and run e2e against a production build. Integration tests do not use it; they boot Payload directly via the harness.
- unit tests co-located with their source (`src/**/*.test.ts`, pure functions, no DB), `tests/int` (boot Payload via the harness), `tests/e2e` (Playwright against the dev app).

Only `dist/` is published (built by tsdown). The `development` export condition points at `src/` so tests and typecheck never need a build; `publishConfig.exports` rewrites the map to `dist/` at publish time.

A package that sets `"apiReport": true` in its `package.json` (`@10x-media/analytics` does) keeps an [API Extractor](https://api-extractor.com/) report per `publishConfig.exports` entry in `api/`, generated from the built declarations by `scripts/api-report.ts`. Every type an entry's signatures reach must be exported from that entry, and each export carries a release tag: untagged is stable, `@beta` may change in a minor, `@internal` is exported for wiring only (a component path an import map resolves). After changing a public export, run `pnpm build <name>` and `pnpm api:update`, review the report diff and commit it with the change; it is what tells a reviewer, and you when picking the changeset bump, what the public surface gained or lost. CI's build job runs `pnpm api:check`, which fails on a stale or missing report, on a forgotten export, and on a docs entry points page (`apps/docs/content/docs/analytics/reference/entry-points.mdx`) the reports no longer generate; `pnpm api:update` regenerates it from `scripts/docs-entry-points.ts`, which also holds the prose beside each entry's list.

`pnpm docs:check` checks every internal link of the docs, and type-checks each `ts` and `tsx` block of the analytics docs against the package's source (`packages/analytics/tests/docs/checkExamples.ts`). A block that is deliberately incomplete opts out with `partial` in its fence meta (```` ```ts partial ````); a package an example imports that no workspace package installs is declared in `packages/analytics/tests/docs/stubs/`. CI's lint job runs it when a change reaches the docs app or analytics.

## Changeset requirement

Any change to `packages/*/src/**` requires a changeset. Run `pnpm changeset`, select the affected packages, choose a bump type, write a user-facing summary line, then commit the generated `.changeset/*.md` with your code. If a change genuinely should not release (docs, CI, internal tooling), apply the `no-release` label instead; do not use it to skip a real code change. CI enforces this on pull requests.

Pick the bump by what a consumer experiences:

- **major**: breaking public API change (export removed or renamed, option shape changed non-additively)
- **minor**: new feature, option, or export
- **patch**: bug fix or internal change with no public API change

The repo is in beta pre-mode (`.changeset/pre.json`, tag `beta`). While in pre-mode every release publishes as `0.x.y-beta.N` regardless of bump type, but the bump you choose is still recorded and determines the version when the project later exits pre-mode and cuts a stable release. Choose the correct bump even during beta.

## Comment and style policy

Comments earn their place: explain why, not restate what. Default to no comment; add one only for intent, a non-obvious constraint, or a gotcha the code cannot express.

- Keep comments high-signal. Cut low-information filler: step-by-step narration of obvious code, "Note:/Important:/In summary:" preambles, and PR or task recap comments.
- No decorative comments: no section banners, ASCII art, or rule lines.
- Plain prose: standard punctuation (no em-dashes), short sentences over padded or hedged ones.
- JSDoc encouraged on anything meaningful; default to no comment otherwise.
- Full policy: [`.cursor/rules/comments.mdc`](./.cursor/rules/comments.mdc).

## Lint conventions (custom rules)

Beyond Biome's defaults, five custom Biome (GritQL) plugins in `config/biome/plugins/` enforce repo conventions. If a lint error surprises you, this is likely why:

- `noProcessEnv`: no direct `process.env` access; read through a validated env module. Env-boundary files (env modules, vitest setup, the test harness) opt out with a `biome-ignore` comment.
- `noRelativeCrossModule`: no `../../` cross-module relative imports; use a package sub-path entry point.
- `noDirectClientImport`: server-side files cannot import from `./exports/client`; move shared code to a server-safe module.
- `requireI18nKeysTyped`: translation lookups must use the typed `keys` constant from `translations/keys.ts`, not string literals.
- `requirePluginFactoryShape` (warning): plugins use named exports, not default-exported arrow functions.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by a `commit-msg` hook (commitlint with `config-conventional`). The hook activates after `git init` (the `prepare` script installs husky). Format:

`type(scope): summary`

- **type**: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `style`.
- **scope** (optional, encouraged): the package short name (`jobs`, `automations`, `webhooks`), or `harness`, `docs`, `repo` for cross-cutting work.
- **summary**: imperative, lower-case, no trailing period.

Examples: `feat(jobs): add stuck-job sweeper`, `fix(harness): close the pg pool before stopping the container`, `docs(jobs): document the multi-node worker`. The commit `type` does not drive the release; the Changeset does. A breaking change still needs a `major` Changeset.

## PR flow

1. Fork or branch from `main`.
2. Make changes, run `pnpm lint <name>` and `pnpm typecheck <name>`, run the relevant test tier.
3. Add a changeset (`pnpm changeset`) or apply the `no-release` label.
4. Open a pull request. CI runs lint, typecheck, tests, and e2e; all must pass. It scopes each of
   those to the packages your change reaches through the dependency graph, so a pull request touching
   one plugin does not run the other ten. E2E runs for each plugin whose package or dev app your
   change reaches, analytics as one job per database; apply the `no_e2e` label to skip it (it takes
   effect on the next push). A change reaching analytics also runs its upgrade test, which `no_e2e`
   does not skip. Changes to
   shared config, the root manifest, the `pnpm-workspace.yaml` catalog, `.github/`, or `scripts/`
   fall back to the whole workspace, and so does a manual `workflow_dispatch` run when you want the
   full suite on demand.
5. PRs land on `main` as a **squash merge**: one commit per PR keeps `main` linear and maps each commit to one Changeset entry. Write the squash commit subject to follow the commit convention above (GitHub defaults the squash subject to the PR title, so title PRs the same way).

For questions, open a [GitHub Discussion](https://github.com/10x-media/payload-plugins/discussions) rather than an issue.

## Release flow (maintainers)

Releases are automated with Changesets and GitHub Actions:

1. When PRs carrying changesets land on `main`, `release.yml` opens or updates a **"Version Packages"** pull request that consumes the queued changesets, bumps each affected package, and updates its `CHANGELOG.md`.
2. Merge the Version Packages PR to cut a release, then publish each bumped package from `main` with `pnpm publish:plugin <name>`. The npm account is `auth-and-writes` 2FA, so publishing uses an interactive browser passkey (CI cannot publish yet: pnpm 10 has no OIDC trusted publishing). The script publishes to npm, then creates and pushes the `@10x-media/<name>@<version>` git tag.
3. Pushing that tag triggers `release-notes.yml`, which creates the per-package GitHub release from the package's `CHANGELOG.md`.

Versioning is independent per package: only packages with queued changesets are bumped, published, and released. **Planned:** after the monorepo moves to pnpm 11, switch to npm OIDC trusted publishing (a per-package Trusted Publisher on npmjs.com, no `NPM_TOKEN`) so CI publishes and creates releases directly again; the `snapshot` label (throwaway `pr-<number>` prereleases) is blocked on the same migration. To leave beta, run `pnpm changeset pre exit`, add a major changeset per package going stable, and merge the resulting Version Packages PR.

## Documentation

The documentation site lives in `apps/docs/` (Fumadocs). Add plugin docs under `apps/docs/content/docs/<slug>/` with a `meta.json` for page order. Run it locally with `pnpm dev docs` (apps under `apps/` are valid short-command targets, the same as plugins). It builds as a static export (`pnpm build docs` writes `apps/docs/out/`) and deploys to GitHub Pages at [docs.10xmedia.de](https://docs.10xmedia.de) via `.github/workflows/docs.yml` on every push to `main` that touches `apps/docs/`.
