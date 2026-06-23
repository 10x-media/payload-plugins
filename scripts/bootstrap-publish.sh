#!/usr/bin/env bash
set -euo pipefail

# Interactive publish for a plugin. Builds, packs with pnpm (so the dist/ exports rewrite
# is applied), then publishes the tarball with npm, whose browser passkey 2FA approval
# pnpm publish cannot do. This is the publishing path for every release (not just the
# first): the npm account is auth-and-writes 2FA and pnpm 10 has no OIDC, so CI cannot
# publish yet. After a successful publish it creates and pushes the @scope/name@version
# git tag, which triggers release-notes.yml to create the GitHub release. Fold publishing
# back into changesets/action once the pnpm 11 + OIDC trusted-publishing migration lands.
#
#   Usage: bash scripts/bootstrap-publish.sh <plugin>     (e.g. jobs)
#
# Prereqs: run `npm login` as the account that owns @10x-media (2FA set up), and run from
# main with the merged Version Packages commit checked out so the tag lands on it.

plugin="${1:?usage: bash scripts/bootstrap-publish.sh <plugin>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/packages/$plugin"
[ -d "$dir" ] || { echo "error: no plugin at packages/$plugin" >&2; exit 1; }

echo "npm account: $(npm whoami 2>/dev/null || echo 'NOT LOGGED IN (run: npm login)')"
( cd "$root" && pnpm build "$plugin" )

cd "$dir"
rm -f ./*.tgz

# publishConfig.provenance forces provenance generation, which only works on a CI OIDC
# provider and overrides env vars and flags, breaking this local publish. No package
# declares it today, but strip it defensively before pack/publish, then restore. Manual
# publishes carry no provenance; the pnpm 11 + OIDC CI will add it automatically.
cp package.json .package.json.orig
trap 'mv -f .package.json.orig package.json 2>/dev/null || true' EXIT
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); if (p.publishConfig) delete p.publishConfig.provenance; fs.writeFileSync('package.json', JSON.stringify(p, null, '\t') + '\n');"

pnpm pack >/dev/null
tgz="$(ls ./*.tgz | head -1)"

# Prerelease versions (e.g. 0.1.0-beta.0) must publish under an explicit dist-tag so
# they never land on `latest`; derive the tag from the version's prerelease id.
tag="$(node -pe "(require('./package.json').version.match(/-([A-Za-z]+)/) || [])[1] || ''")"
echo "publishing $tgz (dist-tag: ${tag:-latest}); approve the 2FA in your browser when it opens..."
if [ -n "$tag" ]; then
  npm publish "$tgz" --access public --tag "$tag"
else
  npm publish "$tgz" --access public
fi
rm -f "$tgz"

# Tag the published version and push it; release-notes.yml turns the tag into a GitHub
# release. The tag points at HEAD, so publish from the merged Version Packages commit.
version="$(node -pe "require('./package.json').version")"
release_tag="@10x-media/${plugin}@${version}"
if git rev-parse -q --verify "refs/tags/${release_tag}" >/dev/null; then
  echo "tag ${release_tag} already exists; not re-tagging"
else
  git tag -a "${release_tag}" -m "${release_tag}"
  git push origin "${release_tag}"
  echo "pushed ${release_tag} -> Release Notes workflow will create the GitHub release"
fi
echo "done. verify with: npm view @10x-media/$plugin version"
