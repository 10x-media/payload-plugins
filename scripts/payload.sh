#!/usr/bin/env bash
# Generic safe wrapper for `payload <command>` (generate:*, migrate:*, etc.).
#
# Defenses against the well-known Payload v3 bin hang where the script writes
# its output successfully but the node process refuses to exit (Mongoose holds
# the event loop open; bin doesn't call process.exit):
#
# 1. Enforces a deadline (default 120s) and force-kills the child if it hangs.
# 2. `.claude/settings.json` `deny` rules block direct `pnpm exec payload *`
#    invocations by agents, forcing them through this wrapper.
# 3. `PAYLOAD_SKIP_AUTOGEN=1` (set in `.claude/settings.json`) keeps Payload's
#    init/reload from auto-spawning generate subprocesses. This wrapper clears
#    it for the call it makes (user explicitly asked for a payload command).
#
# Usage:
#   scripts/payload.sh <package-dir> <command> [extra args]
#
# Examples:
#   scripts/payload.sh packages/automations/dev generate:types
#   scripts/payload.sh packages/automations/dev migrate:create add-jobs-table
#
# Override deadline:
#   PAYLOAD_CMD_DEADLINE=300 scripts/payload.sh ...
#
# Exit codes:
#   0   = success
#   124 = deadline exceeded (process force-killed)
#   *   = forwarded from the underlying payload command

set -eu

DIR="${1:?usage: payload.sh <dir> <command> [args]}"
CMD="${2:?usage: payload.sh <dir> <command> [args]}"
shift 2
DEADLINE="${PAYLOAD_CMD_DEADLINE:-120}"

cd "$DIR"

unset PAYLOAD_SKIP_AUTOGEN

pnpm exec payload "$CMD" "$@" &
PID=$!

WAITED=0
while kill -0 "$PID" 2>/dev/null; do
	if [ "$WAITED" -ge "$DEADLINE" ]; then
		echo "payload.sh: '$CMD' did not finish within ${DEADLINE}s. Killing." >&2
		kill -9 "$PID" 2>/dev/null || true
		pkill -9 -P "$PID" 2>/dev/null || true
		exit 124
	fi
	sleep 1
	WAITED=$((WAITED + 1))
done

wait "$PID"
