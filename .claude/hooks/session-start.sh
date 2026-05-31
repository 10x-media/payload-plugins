#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLUGINS=$(ls "$REPO_ROOT/packages" 2>/dev/null | tr '\n' ' ' || echo "none")

HUNG=$(ps axo pid,pcpu,command 2>/dev/null \
	| awk -v root="$REPO_ROOT" '
		index($0, root) > 0 &&
		($0 ~ /payload\/bin\.js/ ||
		 $0 ~ /next (dev|start)/ ||
		 $0 ~ /tsdown.*--watch/ ||
		 $0 ~ /vitest.*(--watch|--ui)/) { print }' || true)

cat <<EOF
Monorepo: 10x-media/payload-plugins
Available plugins: $PLUGINS

Short commands (no --filter needed, ever):
  pnpm test [name]                          # all tests, or one plugin's
  pnpm test:unit [name]
  pnpm test:int [name]                      # mongo in-memory
  pnpm test:matrix [name]                   # mongo in-memory + postgres container
  pnpm test:container [name]                # both DBs containerized
  pnpm test:e2e <name>                      # docker compose + build + Playwright
  pnpm dev <name>                           # boot dev server
  pnpm start <name>                         # start a built dev app
  pnpm gen <name>                           # regenerate types + importmap
  pnpm migrate <name>                       # apply pending migrations
  pnpm migrate:create <name> <migration>    # create new migration
  pnpm migrate:status <name>
  pnpm migrate:down/refresh/reset/fresh <name>
  pnpm build [name]                         # plugin or app, e.g. pnpm build docs
  pnpm lint [name] / lint:fix [name]
  pnpm typecheck [name]
  pnpm new                                  # scaffold a new plugin
  pnpm changeset                            # author a release entry
  pnpm check:processes / clean:processes

Agent context note:
  PAYLOAD_SKIP_AUTOGEN=1 is set in .claude/settings.json so Payload's
  init/reload do not auto-spawn generate subprocesses (which hang). To
  manually regenerate or migrate when needed: pnpm gen <name>, pnpm migrate <name>.
EOF

if [ -n "$HUNG" ]; then
	cat <<EOF

WARNING: stale repo-owned processes detected. Run \`pnpm clean:processes\`:
$HUNG
EOF
fi
