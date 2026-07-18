#!/usr/bin/env bash
# Find and kill leftovers from this repo's tooling, plus orphaned
# mongodb-memory-server instances.
#
# Safe to run anytime. Never touches the Homebrew/system mongod, an actively
# running test's mongod, Cursor/VSCode, Chrome, or another project's live work.
#
# Usage: pnpm clean:processes [--dry-run]
#
# What it kills:
#   Repo-scoped (command line under this repo):
#     - payload/bin.js (generate:types, generate:importmap, etc.)
#     - next dev / next start
#     - tsdown --watch
#     - vitest --watch / vitest --ui
#   Machine-wide:
#     - orphaned mongodb-memory-server mongods: PPID=1 and either a binary under
#       ~/.cache/mongodb-binaries or a `--dbpath .../mongo-mem-*` temp data dir.
#       These leak when a test run dies before its afterAll teardown fires
#       (deadline SIGKILL, force-stopped session, crash) or when a dev server's
#       HMR reload orphans an old in-memory mongod, and they live outside the
#       repo path so the repo-scoped scan above can never see them. The PPID=1
#       guard means a live test's or dev server's mongod (whose parent is still
#       alive) is skipped; the binary and dbpath signatures are specific to
#       mongodb-memory-server, so the Homebrew mongod (/opt/homebrew/.../mongod,
#       dbpath /opt/homebrew/var/mongodb) is skipped.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

repo_candidates() {
	ps axo pid,pcpu,command \
		| awk -v root="$REPO_ROOT" '
			index($0, root) > 0 &&
			($0 ~ /payload\/bin\.js/ ||
			 $0 ~ /next (dev|start)/ ||
			 $0 ~ /tsdown.*--watch/ ||
			 $0 ~ /vitest.*(--watch|--ui)/) { print }'
}

# Orphaned mongodb-memory-server pids. Match either the cached binary path or a
# mongo-mem-* temp dbpath (covers system-binary setups too), gated on PPID=1 so a
# live parent's mongod is never touched. The awk program text itself contains
# "mongodb-binaries", so exclude the awk line to avoid matching this scan.
orphan_mongo_pids() {
	ps axo pid,ppid,command \
		| awk '$2 == 1 && ($0 ~ /mongodb-binaries\/mongod/ || $0 ~ /--dbpath[ =][^ ]*mongo-mem-/) && $0 !~ /awk/ { print $1 }'
}

CANDIDATES=$(repo_candidates)
ORPHAN_MONGOS=$(orphan_mongo_pids)

if [ -z "$CANDIDATES" ] && [ -z "$ORPHAN_MONGOS" ]; then
	echo "No hung repo processes or orphaned test mongods found."
	exit 0
fi

if [ -n "$CANDIDATES" ]; then
	COUNT=$(printf '%s\n' "$CANDIDATES" | wc -l | tr -d ' ')
	echo "Found $COUNT repo process(es) that look stale:"
	printf '%s\n' "$CANDIDATES" | sed 's/^/  /'
fi

if [ -n "$ORPHAN_MONGOS" ]; then
	MCOUNT=$(printf '%s\n' "$ORPHAN_MONGOS" | wc -l | tr -d ' ')
	echo "Found $MCOUNT orphaned mongodb-memory-server instance(s) (PPID=1):"
	for pid in $ORPHAN_MONGOS; do
		ps -p "$pid" -o pid,rss,command 2>/dev/null | tail -1 | sed 's/^/  /'
	done
fi

if [ "$DRY_RUN" = "1" ]; then
	echo ""
	echo "(--dry-run: no kill performed)"
	exit 0
fi

echo ""
echo "Killing..."
REPO_PIDS=$(printf '%s\n' "$CANDIDATES" | awk 'NF {print $1}')
for pid in $REPO_PIDS $ORPHAN_MONGOS; do
	kill "$pid" 2>/dev/null || true
done

sleep 1

SURVIVORS=$(printf '%s\n%s\n' "$(repo_candidates | awk '{print $1}')" "$(orphan_mongo_pids)" | awk 'NF')
if [ -n "$SURVIVORS" ]; then
	SCOUNT=$(printf '%s\n' "$SURVIVORS" | wc -l | tr -d ' ')
	echo "$SCOUNT survived SIGTERM, sending SIGKILL..."
	for pid in $SURVIVORS; do
		kill -9 "$pid" 2>/dev/null || true
	done
fi

echo "Cleanup complete."
