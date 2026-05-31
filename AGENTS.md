# Agent orientation: @10x-media/payload-plugins

This is a framework-neutral pointer for AI coding agents. The authoritative, fuller guide is [`CLAUDE.md`](./CLAUDE.md). Read that first. This file summarizes the essentials to avoid drift.

## Repo purpose

Turborepo of public `@10x-media/*` Payload v3 plugins, maintained by 10x Media GmbH. Beta pre-mode; packages publish as `*-beta.N`.

## Layout

```
packages/<slug>/          published plugin (@10x-media/<slug>)
packages/<slug>/dev/      nested Next app for local dev (private)
tooling/<name>/           private internal packages (test-harness, plugin-template)
config/<name>/            shared configs (typescript, biome, vitest)
apps/docs/                fumadocs documentation site
scripts/                  run.ts router, gen-plugin.ts scaffolder, payload.sh wrapper, cleanup.sh
```

## Command surface

Positional, short names. Never use `--filter`.

```bash
pnpm install
pnpm build [name]
pnpm dev <name>
pnpm test / pnpm test <name>
pnpm test:unit [name]
pnpm test:int [name]
pnpm test:matrix [name]       # Docker required
pnpm test:container [name]    # Docker required
pnpm test:e2e <name>          # Docker required
pnpm gen <name>
pnpm migrate <name>
pnpm lint [name]
pnpm typecheck [name]
pnpm new                      # scaffold a new plugin
pnpm changeset
pnpm check:processes
pnpm clean:processes
```

`<name>` is a plugin under `packages/` (e.g. `automations`) or an app under `apps/` (e.g. `docs`). Apps do not support `gen` or `migrate`.

## Test tiers

| Tier | Docker? | Command |
|---|---|---|
| Unit | No | `pnpm test:unit [name]` |
| Int (Mongo in-memory) | No | `pnpm test:int [name]` |
| Int (matrix) | Yes | `pnpm test:matrix [name]` |
| Int (container) | Yes | `pnpm test:container [name]` |
| E2E | Yes | `pnpm test:e2e <name>` |

## Process hygiene

- Run `pnpm check:processes` before declaring any task done.
- Never invoke `payload generate:*` or `payload migrate:*` directly. Use `pnpm gen <name>` and `pnpm migrate <name>`, which route through `scripts/payload.sh` (120-second deadline, auto-kills on hang).
- After any long-running command (dev server, watcher, container), verify it is stopped before finishing.

## Comment and style policy

Comments earn their place: explain why, not restate what. Default to no comment; add one only for intent, a non-obvious constraint, or a gotcha the code cannot express.

- Keep comments high-signal. Cut low-information filler: step-by-step narration of obvious code, "Note:/Important:/In summary:" preambles, and PR or task recap comments.
- No decorative comments: no section banners, ASCII art, or rule lines.
- Plain prose: standard punctuation (no em-dashes), short sentences over padded or hedged ones.
- JSDoc encouraged on anything meaningful; default to no comment otherwise.
- Full policy: [`.cursor/rules/comments.mdc`](./.cursor/rules/comments.mdc).
