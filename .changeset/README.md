# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): small markdown files that describe a release.

## Authoring a change

Run `pnpm changeset` (after git is initialized) and the CLI walks you through it. The output is a single `.md` file like this:

```md
---
'@10x-media/automations': minor
---

User-facing description of what changed.
```

Pick the bump type based on impact:
- **major**: breaking change to a public export, option, or behavior
- **minor**: new public feature or option
- **patch**: bug fix, internal refactor

Commit the `.md` file with the code change in the same PR.

## Release flow

On merge to `main`, the `release.yml` workflow opens a "Version Packages" PR that aggregates queued changesets. Merging that PR publishes to npm.

The repo is currently in **beta pre-mode** (`pre.json` present). Releases publish as `*-beta.N`. To exit: `pnpm changeset pre exit` then merge a final major-bump changeset for each plugin going stable.
