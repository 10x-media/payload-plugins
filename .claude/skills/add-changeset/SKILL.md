---
name: add-changeset
description: Use when the user has finished a code change in a plugin and needs to record a changeset for the next release. Picks the bump type based on what changed.
---

# Add a changeset

1. Identify which plugins changed by running `git diff --name-only` and filtering for `packages/*/src/`. This requires an initialized git repo; if the repo is not yet under git, identify changed plugins from the working context instead.
2. For each changed plugin, decide the bump type:
   - **major**: breaking change to public API (export removed/renamed, option shape changed in a non-additive way)
   - **minor**: new public feature, new options, new exports
   - **patch**: bug fix, doc fix, internal refactor with no API surface change
3. Run: `pnpm changeset`. Use space to select packages, then pick the bump and write the user-facing changelog line.
4. The line should describe what the user gets, not what the implementer did. Good: "Add retry policy option to automations". Bad: "Refactor jobs.ts to extract policy logic".
5. Commit the resulting `.changeset/*.md` file with the code change in the same PR.
6. Before declaring done, run `pnpm check:processes` to confirm no hung Payload generate or Next dev processes were left behind during your work.
