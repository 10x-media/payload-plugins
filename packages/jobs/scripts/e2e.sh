#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME="jobs_e2e_$(pwd | cksum | cut -d' ' -f1)"

cleanup() {
	echo "Tearing down e2e DBs..."
	docker compose -f docker-compose.test.yml down -v --remove-orphans || true
}
trap cleanup EXIT

echo "Starting e2e DBs (mongo:8 replSet + postgres:16)..."
docker compose -f docker-compose.test.yml up -d --wait

echo "Running worker-drain process e2e..."
node --import tsx dev/e2e/worker-drain.ts

echo "Building plugin..."
pnpm --filter @10x-media/jobs build

echo "Building dev app..."
pnpm --filter @10x-media/jobs-dev build

echo "Running Playwright e2e..."
pnpm --filter @10x-media/jobs exec playwright test "$@"
