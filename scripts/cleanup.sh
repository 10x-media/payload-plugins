#!/usr/bin/env bash
# Find and kill any long-running processes that belong to THIS repo.
# Safe to run anytime. Does NOT touch processes from other projects, system
# mongod, Cursor/VSCode, Chrome, etc.
#
# Usage: pnpm clean:processes [--dry-run]
#
# What it kills:
#   - payload/bin.js (generate:types, generate:importmap, etc.)
#   - next dev / next start
#   - tsdown --watch
#   - vitest --watch / vitest --ui

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# Collect candidate lines. Bash 3.2 compatible (no mapfile).
CANDIDATES=$(ps axo pid,pcpu,command \
	| awk -v root="$REPO_ROOT" '
		index($0, root) > 0 &&
		($0 ~ /payload\/bin\.js/ ||
		 $0 ~ /next (dev|start)/ ||
		 $0 ~ /tsdown.*--watch/ ||
		 $0 ~ /vitest.*(--watch|--ui)/) { print }')

if [ -z "$CANDIDATES" ]; then
	echo "No hung repo processes found."
	exit 0
fi

COUNT=$(printf '%s\n' "$CANDIDATES" | wc -l | tr -d ' ')
echo "Found $COUNT repo process(es) that look stale:"
printf '%s\n' "$CANDIDATES" | sed 's/^/  /'

if [ "$DRY_RUN" = "1" ]; then
	echo ""
	echo "(--dry-run: no kill performed)"
	exit 0
fi

echo ""
echo "Killing..."
PIDS=$(printf '%s\n' "$CANDIDATES" | awk '{print $1}')
for pid in $PIDS; do
	kill "$pid" 2>/dev/null || true
done

sleep 1

SURVIVORS=$(ps axo pid,pcpu,command \
	| awk -v root="$REPO_ROOT" '
		index($0, root) > 0 &&
		($0 ~ /payload\/bin\.js/ ||
		 $0 ~ /next (dev|start)/ ||
		 $0 ~ /tsdown.*--watch/ ||
		 $0 ~ /vitest.*(--watch|--ui)/) { print $1 }')

if [ -n "$SURVIVORS" ]; then
	SCOUNT=$(printf '%s\n' "$SURVIVORS" | wc -l | tr -d ' ')
	echo "$SCOUNT survived SIGTERM, sending SIGKILL..."
	for pid in $SURVIVORS; do
		kill -9 "$pid" 2>/dev/null || true
	done
fi

echo "Cleanup complete."
