---
name: scaffold-plugin
description: Use when the user wants to add a new Payload plugin to this monorepo. Runs `pnpm new` and walks the user through the slug and description prompts.
---

# Scaffold a new plugin

1. Confirm the plugin slug (kebab-case, no scope) and one-line description with the user before running the generator.
2. Run: `pnpm new`. The interactive prompt collects slug and description.
3. After creation, run `pnpm install` to link the new workspace package.
4. Run the smoke test: `pnpm test <slug>`.
5. Tell the user where the plugin lives and how to add a changeset for the initial scaffold.
6. Run `pnpm check:processes` to confirm the smoke test left no hung Mongo or Payload processes.

Do not scaffold without confirming the slug. Renaming a plugin after the fact is a rename across many files.
