#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME="document-preview_e2e_$(pwd | cksum | cut -d' ' -f1)"

# Per-worktree port block so parallel e2e runs never collide on host ports (the
# compose project name above already isolates containers). Explicit *_E2E_PORT wins.
offset=$(( $(pwd | cksum | cut -d' ' -f1) % 500 ))
export MONGO_E2E_PORT="${MONGO_E2E_PORT:-$((37017 + offset))}"
export PG_E2E_PORT="${PG_E2E_PORT:-$((35432 + offset))}"
export E2E_NEXT_PORT="${E2E_NEXT_PORT:-$((3100 + offset))}"

cleanup() {
	echo "Tearing down e2e DBs..."
	docker compose -f docker-compose.test.yml down -v --remove-orphans || true
}
trap cleanup EXIT

echo "Starting e2e DBs (mongo:8.2.12 replSet + postgres:16)..."
docker compose -f docker-compose.test.yml up -d --wait

# E2E_FRAMEWORK=tanstack runs the suite on the TanStack Start dev app, anything else on the Next
# one; either way against its production build (see playwright.config.ts).
if [[ "${E2E_FRAMEWORK:-next}" == tanstack ]]; then
	app=@10x-media/document-preview-dev-tanstack
else
	app=@10x-media/document-preview-dev
fi

# Everything the dev app imports from the workspace, not just this plugin: a fresh
# checkout has no dist/ for any of it.
echo "Building the dev app's workspace dependencies..."
pnpm --filter "${app}^..." build

echo "Building dev app..."
pnpm --filter "$app" build

echo "Running Playwright e2e..."
pnpm --filter @10x-media/document-preview exec playwright test "$@"
