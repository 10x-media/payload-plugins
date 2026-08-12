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

# Tests (see tiers below)
pnpm test               # all packages, Mongo in-memory
pnpm test <name>        # one plugin
pnpm test:unit [name]
pnpm test:int [name]
pnpm test:matrix [name]
pnpm test:container [name]
pnpm test:e2e <name>

# Docs showcase clips (needs `pnpm dev <name>` already running)
pnpm videos <name>
```

`<name>` is the directory name under `packages/` (e.g. `automations`).

## Test tiers

| Tier | When | Docker? | Command |
|---|---|---|---|
| Unit | Pure functions, no DB; co-located `src/**/*.test.ts` | No | `pnpm test:unit [name]` |
| Int (Mongo) | Integration, fast (MongoMemoryReplSet) | No | `pnpm test:int [name]` |
| Int (matrix) | Cross-DB: Mongo in-memory + Postgres container | Yes | `pnpm test:matrix [name]` |
| Int (container) | Both DBs containerized | Yes | `pnpm test:container [name]` |
| E2E | Production build + Playwright + docker compose | Yes | `pnpm test:e2e <name>` |

There is no in-process Postgres option. Postgres tiers always use a real Docker container (`postgres:16` via testcontainers).

## Parallel development and worktrees

Everything is safe to run in parallel across multiple git worktrees, with no per-worktree setup:

- **Tests** (unit, int, matrix, container) bind ephemeral ports: testcontainers let the OS assign a free host port per container, and in-memory Mongo picks a random port. Each worktree has its own `node_modules`, and the turbo cache is content-hashed, so concurrent runs never collide.
- **e2e self-isolates.** `scripts/e2e.sh` derives both its `COMPOSE_PROJECT_NAME` and its host ports (Mongo/Postgres/Next) from the worktree, so two worktrees can run e2e at once untouched. Pin them with `MONGO_E2E_PORT` / `PG_E2E_PORT` / `E2E_NEXT_PORT` if you ever need fixed ports.
- **Dev server.** `pnpm dev <name>` defaults to port 3000 (`${PORT:-3000}`); set `PORT` to run a second dev server from another worktree.

## Writing tests

Integration tests use the `@10x-media/payload-test-harness` helpers:

- `bootPayload({ plugin, db, seed?, collections?, configOverrides? })`: boots a real Payload instance on the given DB (`'mongo'` or `'postgres'`) and returns `{ payload, db, stop }`. Always call `stop()` in `afterAll`.
- `describeForDb(name, { dbs? }, (db) => { ... })`: runs the block once per DB. Omit `dbs` to honor the `DB_MATRIX` env (defaults to Mongo); the `test:matrix` and `test:container` scripts set it to `mongo,postgres`.
- `expectForDb(db, { mongo, postgres })` and `skipForDb(...)`: assert or skip per adapter when behavior legitimately differs (for example, Mongo lacks native cascade deletes).

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
4. Open a pull request. CI runs lint, typecheck, and tests; all must pass.
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
