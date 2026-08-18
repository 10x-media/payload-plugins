---
name: worktree-dev
description: Use when working inside a git worktree of this monorepo and a dev server is needed, when starting or verifying `pnpm dev <name>`, picking a port, opening a browser preview from a worktree, or cleaning up dev processes before finishing.
---

# Dev servers in a worktree

Every worktree has its own dev server port, always. `pnpm dev <name>` run from the worktree derives a stable port from the worktree directory name (band 4100-4999) and prints it with the full URL; the same worktree gets the same port every session. `PORT=<n>` overrides. The primary checkout is untouched: there `pnpm dev <name>` still defaults to :3000 (and `.claude/launch.json` still pins the 31xx ports), which `pnpm videos` depends on.

## Starting one

1. Run from the worktree root, in the background:

   ```bash
   PAYLOAD_SKIP_AUTOGEN=1 pnpm dev <name>
   ```

   Capture the printed port from the first lines of output. Record the PID or background task id.

2. Do NOT use `preview_start` with a launch.json name from a worktree session: it reads the PRIMARY checkout's `.claude/launch.json` and boots the primary's code, not the worktree's. Attach the browser pane to the running worktree server instead: `preview_start` with `{url: "http://localhost:<derived port>"}`, then `navigate`.

3. Never edit the primary checkout's `.claude/launch.json` to add worktree entries; they go stale when the worktree is removed and dirty the primary's tree.

## Verifying the port logic without booting

`pnpm dev <name>` prints the derived line before Next.js starts. To see the port a worktree will get without starting anything, read it from the first line and Ctrl-C, or compute nothing: the line is `[worktree <dir>] <name> server on port <port> → http://localhost:<port>`.

## Before finishing

Kill every dev server you started (by PID or your own port, never a blind `pkill -f next`), then:

```bash
pnpm check:processes
```

The dev app's in-memory mongod can outlive the Next process; `pnpm clean:processes` reaps it.
