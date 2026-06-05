#!/usr/bin/env bash
# Reap orphaned mongodb-memory-server instances when a Claude Code session ends.
#
# These leak machine-wide (PPID=1, path under ~/.cache/mongodb-binaries) when a
# test run is killed before its afterAll teardown fires. Reaping on session end
# stops them accumulating across days of work.
#
# Only PPID=1 orphans are touched, so a *running* test's mongod (parent alive)
# and the Homebrew system mongod (different path) are never affected, even when
# other sessions are running tests in parallel. Repo dev servers are deliberately
# NOT killed here: a parallel session may own them.
set -euo pipefail

ORPHANS=$(ps axo pid,ppid,command 2>/dev/null \
	| awk '$2 == 1 && $0 ~ /mongodb-binaries\/mongod/ && $0 !~ /awk/ { print $1 }' || true)

[ -z "$ORPHANS" ] && exit 0

for pid in $ORPHANS; do kill "$pid" 2>/dev/null || true; done
sleep 1
for pid in $ORPHANS; do kill -9 "$pid" 2>/dev/null || true; done

COUNT=$(printf '%s\n' "$ORPHANS" | wc -l | tr -d ' ')
echo "Reaped $COUNT orphaned mongodb-memory-server instance(s)."
