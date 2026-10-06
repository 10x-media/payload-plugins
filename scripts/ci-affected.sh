#!/usr/bin/env bash
# Resolves the git range that turbo's `--affected` compares against, and emits the flag
# itself as the `flag` step output so every caller shares one fallback decision: when the
# range cannot be trusted, `flag` comes back empty and the job runs the whole workspace
# rather than silently testing nothing.
#
# The base comes in as AFFECTED_BASE_SHA (set once at the workflow level: a pull request's
# base sha, a push's `before` sha, empty for anything else). Turbo reads the resolved range
# from TURBO_SCM_BASE/TURBO_SCM_HEAD, which this writes to GITHUB_ENV.
#
# Scoping is per package but never per directory: turbo walks the package graph, so a change
# to `jobs` also selects `automations`, and a change to a path in turbo.json's
# globalDependencies (`config/**`, the root manifest, the catalog) selects everything.
#
# The workflows and the scripts they call are the exception turbo cannot see: they are not a
# build input of any package, so scoping them would let a pull request that rewrites CI go
# green having run nothing at all. They force the fallback instead.
#
# Requires a full checkout (`fetch-depth: 0`); a shallow one has no base commit to diff
# against and takes the fallback.
set -euo pipefail

emit() { echo "$1" >>"${GITHUB_OUTPUT:?GITHUB_OUTPUT is unset; this runs as a GitHub Actions step}"; }

fallback() {
	echo "affected: $1, running the whole workspace"
	emit 'flag='
	exit 0
}

base="${AFFECTED_BASE_SHA:-}"

# workflow_dispatch and a re-run of a deleted branch carry no previous state to diff against.
[ -n "$base" ] || fallback 'the event carries no base commit'
# A branch's first push reports the null sha.
[ "$base" != '0000000000000000000000000000000000000000' ] || fallback 'the base sha is null'
git cat-file -e "${base}^{commit}" 2>/dev/null ||
	fallback "base ${base} is missing from this checkout (shallow clone, or force-pushed away)"

# The file list is captured on its own line so a failing diff cannot pass for an empty one:
# `cat-file` above proves the commit exists, not that it shares history with HEAD, and an
# unrelated base makes `git diff` exit 128 while the guard below would read "CI untouched"
# on exactly the run that most needs catching. Counting from a here-string rather than a
# pipe keeps `grep`'s no-match exit off `pipefail` too.
changed=$(git diff --name-only "${base}...HEAD") ||
	fallback "git cannot diff ${base}...HEAD (unrelated history?)"
meta_changed=$(grep -Ec '^(\.github/|scripts/)' <<<"$changed" || true)
[ "$meta_changed" -eq 0 ] || fallback 'the change touches CI itself'

echo "affected: comparing ${base}...HEAD"
{
	echo "TURBO_SCM_BASE=${base}"
	echo 'TURBO_SCM_HEAD=HEAD'
} >>"${GITHUB_ENV:?}"
emit 'flag=--affected'
