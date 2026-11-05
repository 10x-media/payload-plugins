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
#    init/reload from auto-spawning generate subprocesses. `generate:*` never
#    reads it, so the wrapper clears it there. `migrate:*` boots Payload, whose
#    init would otherwise spawn `generate:types` and rewrite the dev app's
#    payload-types.ts from whichever config it loaded, so it is forced on there.
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

case "$CMD" in
	migrate*) export PAYLOAD_SKIP_AUTOGEN=1 ;;
	*) unset PAYLOAD_SKIP_AUTOGEN ;;
esac

# A background job of a non-interactive shell reads /dev/null unless told otherwise, and
# migrate:create asks on stdin whether each new table is created or renamed.
pnpm exec payload "$CMD" "$@" <&0 &
PID=$!

# Every process under $1, deepest first. Listed before any is killed: once pnpm dies, the payload
# node process it started is reparented and no longer found under it.
descendants() {
	local child
	for child in $(pgrep -P "$1" 2>/dev/null); do
		descendants "$child"
		echo "$child"
	done
}

WAITED=0
while kill -0 "$PID" 2>/dev/null; do
	if [ "$WAITED" -ge "$DEADLINE" ]; then
		echo "payload.sh: '$CMD' did not finish within ${DEADLINE}s. Killing." >&2
		# shellcheck disable=SC2046 # one PID per word
		kill -9 $(descendants "$PID") "$PID" 2>/dev/null || true
		exit 124
	fi
	sleep 1
	WAITED=$((WAITED + 1))
done

wait "$PID"
