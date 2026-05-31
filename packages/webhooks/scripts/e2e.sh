#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() {
	echo "Tearing down e2e DBs..."
	docker compose -f docker-compose.test.yml down -v --remove-orphans || true
}
trap cleanup EXIT

echo "Starting e2e DBs (mongo:8 replSet + postgres:16)..."
docker compose -f docker-compose.test.yml up -d --wait

echo "Building plugin..."
pnpm --filter @10x-media/webhooks build

echo "Building dev app..."
pnpm --filter @10x-media/webhooks-dev build

echo "Running Playwright e2e..."
pnpm --filter @10x-media/webhooks exec playwright test "$@"
