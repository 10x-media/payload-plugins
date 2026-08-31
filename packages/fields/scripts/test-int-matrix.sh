#!/usr/bin/env bash
set -euo pipefail

# The one cross-database spec list. test:matrix and test:container both run it
# (container adds TEST_DB=container in its script line, inherited here), so a
# new int spec is added exactly once or it silently never runs on Postgres.
specs=(
	tests/int/matrix.int.spec.ts
	tests/int/color.int.spec.ts
	tests/int/color-schemes.int.spec.ts
	tests/int/color-format.int.spec.ts
	tests/int/icon.int.spec.ts
	tests/int/encrypted.int.spec.ts
	tests/int/encrypted-query.int.spec.ts
	tests/int/encrypted-write-only.int.spec.ts
	tests/int/encrypted-aad-scope.int.spec.ts
)

DB_MATRIX=mongo vitest run "${specs[@]}"
DB_MATRIX=postgres vitest run "${specs[@]}"
