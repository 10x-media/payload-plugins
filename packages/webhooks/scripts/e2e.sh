#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"

cd "$PKG_DIR"

cleanup() {
	echo "Tearing down e2e DBs..."
	docker compose -f docker-compose.test.yml down -v --remove-orphans || true
}
trap cleanup EXIT

echo "Starting e2e DBs (mongo:8 replSet + postgres:16)..."
docker compose -f docker-compose.test.yml up -d --wait

echo "Building plugin..."
pnpm --filter @10x-media/webhooks build

echo "Generating dev app import map..."
bash "$REPO_ROOT/scripts/payload.sh" "$PKG_DIR/dev" generate:importmap

echo "Building dev app..."
pnpm --filter @10x-media/webhooks-dev build

echo "Running Playwright e2e..."
pnpm --filter @10x-media/webhooks exec playwright test "$@"
