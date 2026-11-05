#!/usr/bin/env bash
# Upgrades a 1.0.0-beta.11 install to this tree the way the upgrading page describes, once per
# database in UPGRADE_DBS (default every one) and install shape in UPGRADE_VARIANTS, each on a
# fresh database. The shapes, since the page edits the migration differently for each:
#
#   tasks   ran native retention, warming and sync, so Payload's jobs table holds their runs
#   none    ran no task, and gains Payload's jobs with this release (Postgres and SQLite only)
#   sync    ran sync alone, so the jobs table's task enum has no label of the retired tasks
#           (Postgres and SQLite only)
#   scoped  a multi-tenant install, whose tenants each need a `native` provider document
#
#   1. beta.11, from a detached worktree of its tag: migrate:create and migrate (Postgres and
#      SQLite), then three pageviews through its ingest endpoint, a provider document and a goal
#      (per tenant when scoped) and queued runs of the tasks the install registered.
#   2. this tree: migrate:create analytics_storage answering "create" to every prompt and the
#      page's edits applied (MongoDB: the drop-legacy-mongo predefined migration), migrate, then
#      migrate:status must list every migration as run, migrate:create --skip-empty must create
#      nothing, and the upgraded host must ingest and read through the new endpoints.
#
# It installs beta.11's dependencies and, for SQLite, the adapter that release pinned, so it needs
# the npm registry (or a pnpm store that already holds them) as well as Docker.
#
#   pnpm test:upgrade analytics
#   UPGRADE_DBS=postgres UPGRADE_VARIANTS='sync scoped' pnpm test:upgrade analytics
set -euo pipefail

cd "$(dirname "$0")/.."
PKG="$(pwd)"
REPO="$(cd ../.. && pwd)"
TAG='@10x-media/analytics@1.0.0-beta.11'

UPGRADE_DBS="${UPGRADE_DBS:-postgres sqlite mongo}"
for db in $UPGRADE_DBS; do
	case "$db" in
	mongo | postgres | sqlite) ;;
	*)
		echo "UPGRADE_DBS names an unknown database: ${db} (use mongo, postgres, sqlite)" >&2
		exit 2
		;;
	esac
done
UPGRADE_VARIANTS="${UPGRADE_VARIANTS:-tasks none sync scoped}"
for variant in $UPGRADE_VARIANTS; do
	case "$variant" in
	tasks | none | sync | scoped) ;;
	*)
		echo "UPGRADE_VARIANTS names an unknown install: ${variant} (use tasks, none, sync, scoped)" >&2
		exit 2
		;;
	esac
done

# Its own compose project and ports, so it runs beside an e2e run of the same worktree.
COMPOSE_PROJECT_NAME="analytics_upgrade_$(pwd | cksum | cut -d' ' -f1)"
export COMPOSE_PROJECT_NAME
offset=$((($(pwd | cksum | cut -d' ' -f1) + 250) % 500))
export MONGO_E2E_PORT="${MONGO_UPGRADE_PORT:-$((37017 + offset))}"
export PG_E2E_PORT="${PG_UPGRADE_PORT:-$((35432 + offset))}"

work="$(mktemp -d "${TMPDIR:-/tmp}/analytics-upgrade.XXXXXX")"
beta11="$work/beta11"
beta11_dev="$beta11/packages/analytics/dev"
upgraded_migrations="$PKG/tests/upgrade/.work/migrations"

cleanup() {
	echo "Tearing down the upgrade test..."
	docker compose -f docker-compose.test.yml down -v --remove-orphans || true
	if [ -d "$beta11" ]; then
		git -C "$REPO" worktree remove --force "$beta11" || true
	fi
	rm -rf "$work" "$PKG/tests/upgrade/.work"
	# Forgets the checkout when the removal above failed, or a killed run left one behind.
	git -C "$REPO" worktree prune || true
}
trap cleanup EXIT

payload() {
	PAYLOAD_CMD_DEADLINE="${PAYLOAD_CMD_DEADLINE:-300}" bash "$REPO/scripts/payload.sh" "$@"
}

# What a host's tsconfig says, so the generated migrations load as they do in an app; this repo's
# own `verbatimModuleSyntax` would keep the type names they import as values.
cat >"$work/tsconfig.json" <<'JSON'
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "esnext",
		"moduleResolution": "bundler",
		"jsx": "react-jsx",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true
	}
}
JSON
export TSX_TSCONFIG_PATH="$work/tsconfig.json"
export UPGRADE_SECRET='upgrade-test-secret-material-32-bytes!!'

echo "Checking out ${TAG}..."
git -C "$REPO" worktree prune
git -C "$REPO" worktree add --detach "$beta11" "$TAG"
(cd "$beta11" && pnpm install --frozen-lockfile --prefer-offline)
# beta.11 reads its providers' keys through @10x-media/fields, imported from its built output.
(cd "$beta11" && pnpm --filter '@10x-media/fields...' build)
case " $UPGRADE_DBS " in
*" sqlite "*)
	# beta.11's dev app never installed the SQLite adapter; this one is the version the tag pins.
	sqlite_version="$(node -p "require('$beta11_dev/node_modules/payload/package.json').version")"
	(cd "$beta11_dev" && pnpm add "@payloadcms/db-sqlite@${sqlite_version}" --prefer-offline)
	;;
esac
mkdir -p "$beta11_dev/upgrade"
cp "$PKG/scripts/upgrade/beta11/payload.config.ts" "$PKG/scripts/upgrade/beta11/seed.ts" "$beta11_dev/upgrade/"

echo "Building this tree's package, as a host installs it..."
(cd "$REPO" && pnpm --filter '@10x-media/analytics...' build)

services=()
for db in $UPGRADE_DBS; do
	if [ "$db" != sqlite ]; then
		services+=("$db")
	fi
done
if [ "${#services[@]}" -gt 0 ]; then
	docker compose -f docker-compose.test.yml up -d --wait "${services[@]}"
fi

# upgrade <db> <variant>: beta.11's host in the shape the variant names, on a database of its own.
upgrade() {
	local db="$1" variant="$2"
	local name="analytics_upgrade_${variant}"
	echo "=== Upgrading beta.11 on ${db}, install ${variant} ==="
	export UPGRADE_DB="$db" UPGRADE_VARIANT="$variant"
	# The edits the upgrading page asks of this install: no DELETE of retired runs where Payload's
	# jobs table does not exist yet, and a `native` provider document per tenant when scoped.
	local edits=()
	case "$variant" in
	none) edits+=(--no-prior-tasks) ;;
	scoped) edits+=(--no-prior-tasks --native-tenants 'alpha,beta') ;;
	esac
	case "$db" in
	postgres) export UPGRADE_DATABASE_URL="postgres://e2e:e2e@localhost:${PG_E2E_PORT}/${name}" ;;
	mongo) export UPGRADE_DATABASE_URL="mongodb://localhost:${MONGO_E2E_PORT}/${name}?replicaSet=rs0&directConnection=true" ;;
	sqlite) export UPGRADE_DATABASE_URL="file:${work}/${name}.db" ;;
	esac

	local beta11_migrations="$beta11_dev/upgrade/migrations"
	rm -rf "$beta11_migrations" "$upgraded_migrations"
	mkdir -p "$beta11_migrations"

	echo "--- beta.11: migrate, then ingest"
	export UPGRADE_MIGRATIONS="$beta11_migrations"
	export PAYLOAD_CONFIG_PATH="$beta11_dev/upgrade/payload.config.ts"
	if [ "$db" != mongo ]; then
		payload "$beta11_dev" migrate:create beta11
		payload "$beta11_dev" migrate
	fi
	NODE_ENV=production payload "$beta11_dev" run upgrade/seed.ts

	echo "--- this tree: the host's migrations move with its code"
	mkdir -p "$(dirname "$upgraded_migrations")"
	cp -R "$beta11_migrations" "$upgraded_migrations"
	export UPGRADE_MIGRATIONS="$upgraded_migrations"
	export PAYLOAD_CONFIG_PATH="$PKG/tests/upgrade/host.config.ts"
	if [ "$db" = mongo ]; then
		payload "$PKG" migrate:create analytics_storage --file @10x-media/analytics/migrations/drop-legacy-mongo
	else
		# Every new table and enum is created, never renamed from an old one: Return takes the
		# first choice of each prompt, which is "create". A piped newline reads as Enter, which
		# the prompts ignore, so each answer is a carriage return.
		{ yes $'\r' || true; } | payload "$PKG" migrate:create analytics_storage
	fi
	local generated
	generated="$(find "$upgraded_migrations" -name '*_analytics_storage.ts')"
	# The `+` form keeps an empty list from tripping `set -u` on the bash 3.2 macOS ships.
	node "$PKG/tests/upgrade/editMigration.ts" "$generated" "$db" ${edits[@]+"${edits[@]}"}
	payload "$PKG" migrate

	local status
	status="$(payload "$PKG" migrate:status 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
	echo "$status"
	if grep -Eq '│ +No +│' <<<"$status" || ! grep -Eq '│ +Yes +│' <<<"$status"; then
		echo "migrate:status lists a migration that did not run" >&2
		return 1
	fi

	local before after
	before="$(find "$upgraded_migrations" -type f -not -name index.ts | sort)"
	payload "$PKG" migrate:create check --skip-empty
	after="$(find "$upgraded_migrations" -type f -not -name index.ts | sort)"
	if [ "$before" != "$after" ]; then
		echo "migrate:create --skip-empty created a migration: the schema the upgrade left differs from the config" >&2
		diff <(echo "$before") <(echo "$after") >&2 || true
		return 1
	fi
	echo "migrate:create --skip-empty created nothing"

	NODE_ENV=production payload "$PKG" run tests/upgrade/verify.ts
}

for db in $UPGRADE_DBS; do
	for variant in $UPGRADE_VARIANTS; do
		# MongoDB has no schema to migrate and no task enum, so a host that gains jobs or ran sync
		# alone needs nothing the tasks variant does not already cover there.
		if [ "$db" = mongo ] && { [ "$variant" = none ] || [ "$variant" = sync ]; }; then
			continue
		fi
		upgrade "$db" "$variant"
	done
done
echo "Upgrade from beta.11 verified on: ${UPGRADE_DBS} (installs: ${UPGRADE_VARIANTS})"
