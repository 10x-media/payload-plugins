#!/usr/bin/env bash
# Rebuilds every plugin's shadcn registry (`registry:build`, where a package has
# one) and fails when the committed `registry/r` output drifted from its
# sources, new or deleted files included. The docs site serves those files as is.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm -r --filter './packages/*' --if-present registry:build
spec=':(glob)packages/*/registry/r/**'
# Against the index, so a rebuild that was already staged is not drift.
drift="$(git diff --name-only -- "$spec"; git ls-files --others --exclude-standard -- "$spec")"
if [ -n "$drift" ]; then
	echo "Registry output drifted from its sources. Run 'pnpm check:registry' and commit packages/*/registry/r:" >&2
	echo "$drift" >&2
	exit 1
fi
echo "registry: up to date"
