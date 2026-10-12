#!/usr/bin/env bash
# Builds the dev app once, then runs the Playwright suite against each database in E2E_DBS
# (default every one the plugin supports), in both tenancy modes, plus the slow-source checks.
# Extra arguments go to every `playwright test` call.
#
#   E2E_DBS=postgres pnpm test:e2e analytics      # one database
#   E2E_DBS='mongo sqlite' pnpm test:e2e analytics
set -euo pipefail

cd "$(dirname "$0")/.."

E2E_DBS="${E2E_DBS:-mongo postgres sqlite}"
for db in $E2E_DBS; do
	case "$db" in
	mongo | postgres | sqlite) ;;
	*)
		echo "E2E_DBS names an unknown database: ${db} (use mongo, postgres, sqlite)" >&2
		exit 2
		;;
	esac
done

COMPOSE_PROJECT_NAME="analytics_e2e_$(pwd | cksum | cut -d' ' -f1)"
export COMPOSE_PROJECT_NAME

# Per-worktree port block so parallel e2e runs never collide on host ports (the
# compose project name above already isolates containers). Explicit *_E2E_PORT wins.
offset=$(($(pwd | cksum | cut -d' ' -f1) % 500))
export MONGO_E2E_PORT="${MONGO_E2E_PORT:-$((37017 + offset))}"
export PG_E2E_PORT="${PG_E2E_PORT:-$((35432 + offset))}"
export E2E_NEXT_PORT="${E2E_NEXT_PORT:-$((3100 + offset))}"

# SQLite files live in a folder of this run's own, removed with the containers.
E2E_SQLITE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/analytics-e2e-sqlite.XXXXXX")"
export E2E_SQLITE_DIR

cleanup() {
	echo "Tearing down e2e DBs..."
	docker compose -f docker-compose.test.yml down -v --remove-orphans || true
	rm -rf "$E2E_SQLITE_DIR"
}
trap cleanup EXIT

services=()
for db in $E2E_DBS; do
	if [ "$db" != sqlite ]; then
		services+=("$db")
	fi
done
if [ "${#services[@]}" -gt 0 ]; then
	echo "Starting e2e DBs (${services[*]})..."
	docker compose -f docker-compose.test.yml up -d --wait "${services[@]}"
fi

# Everything the dev app imports from the workspace, not just this plugin: a fresh
# checkout has no dist/ for any of it.
echo "Building the dev app's workspace dependencies..."
pnpm --filter '@10x-media/analytics-dev^...' build

echo "Building dev app..."
pnpm --filter @10x-media/analytics-dev build

# `next start` is production, so Postgres and SQLite never push a schema: each boot applies the
# dev app's migration chain for its tenancy mode (`prodMigrations` in dev/payload.config.ts).
# A pass the extra arguments leave without tests (a single spec file, say) is not a failure.
for db in $E2E_DBS; do
	export DEV_DB="$db"

	echo "Running Playwright e2e (DEV_DB=${db}, TENANCY=off)..."
	TENANCY=off E2E_REUSE_SERVER=0 pnpm --filter @10x-media/analytics exec playwright test \
		--pass-with-no-tests --grep-invert '@tenancy|@slow-source' "$@"

	echo "Running Playwright e2e (DEV_DB=${db}, TENANCY=on)..."
	TENANCY=on E2E_REUSE_SERVER=0 pnpm --filter @10x-media/analytics exec playwright test \
		--pass-with-no-tests --grep @tenancy "$@"

	echo "Running Playwright e2e (DEV_DB=${db}, slow source)..."
	TENANCY=off ANALYTICS_SLOW_SOURCE_MS=10000 E2E_REUSE_SERVER=0 \
		pnpm --filter @10x-media/analytics exec playwright test \
		--pass-with-no-tests --grep @slow-source "$@"
done
