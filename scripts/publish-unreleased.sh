#!/usr/bin/env bash
set -euo pipefail

# CI publish step of release.yml, authenticated by npm trusted publishing (OIDC): no token,
# and npm attaches provenance on its own. Every public package under packages/ whose
# current version is not on npm yet is built, packed with pnpm (which applies the
# publishConfig.exports rewrite and resolves workspace: and catalog: ranges) and published
# with npm, the only client that speaks OIDC to the registry.
#
# It is idempotent, so a failed run never needs a version bump: re-running the job, or
# dispatching release.yml from the branch, publishes whatever is still missing and skips
# the rest. A package that fails does not stop the others; the run exits non-zero at the end.
#
# Everything goes to `latest`: main is the Payload 3 line and owns that dist-tag, beta
# versions included (0.1.0-beta.7 is what `npm install` should get). The Payload 4 line
# publishes from v4 under `alpha` and never moves it. Each published version gets its
# @10x-media/<name>@<version> tag on HEAD, and release-notes.yml is dispatched for it: a tag
# pushed with GITHUB_TOKEN starts no workflow by itself, a workflow_dispatch does.
#
# A package must exist on npm with a trusted publisher before this can publish it, so a new
# plugin's first release still goes through `pnpm publish:plugin <name>`.
#
# Requires: npm >= 11.5.1, `id-token: write`, `contents: write` and `actions: write`, and
# GH_TOKEN in the environment.

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

pending=()
for manifest in packages/*/package.json; do
	read -r name version private < <(node -e "const p=require('./$manifest'); console.log(p.name, p.version, p.private === true)")
	if [ "$private" = "true" ]; then
		continue
	fi
	if [ "$(npm view "$name@$version" version 2>/dev/null || true)" = "$version" ]; then
		continue
	fi
	pending+=("$(dirname "$manifest")")
done

if [ "${#pending[@]}" -eq 0 ]; then
	echo "every public package is already on npm; nothing to publish"
	exit 0
fi

echo "to publish:"
printf '  %s\n' "${pending[@]}"

filters=()
for dir in "${pending[@]}"; do
	filters+=("--filter=./$dir")
done
pnpm exec turbo run build "${filters[@]}"

out="$(mktemp -d)"
failed=()
for dir in "${pending[@]}"; do
	read -r name version < <(node -e "const p=require('./$dir/package.json'); console.log(p.name, p.version)")
	tag=latest
	dest="$out/${dir##*/}"
	mkdir -p "$dest"

	echo "::group::$name@$version (dist-tag: $tag)"
	if (cd "$dir" && pnpm pack --pack-destination "$dest" >/dev/null) &&
		npm publish "$dest"/*.tgz --access public --tag "$tag"; then
		release_tag="$name@$version"
		if git rev-parse -q --verify "refs/tags/$release_tag" >/dev/null; then
			echo "tag $release_tag already exists; not re-tagging"
		else
			git tag -a "$release_tag" -m "$release_tag"
			git push origin "refs/tags/$release_tag"
		fi
		gh workflow run release-notes.yml --ref "$GITHUB_REF_NAME" -f tag="$release_tag"
	else
		echo "::error::failed to publish $name@$version"
		failed+=("$name@$version")
	fi
	echo "::endgroup::"
done

if [ "${#failed[@]}" -gt 0 ]; then
	echo "::error::not published: ${failed[*]}. Fix the cause and re-run this job; published versions are skipped."
	exit 1
fi
