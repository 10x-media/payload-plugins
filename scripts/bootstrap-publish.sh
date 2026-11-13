#!/usr/bin/env bash
set -euo pipefail

# Interactive publish for a plugin. Builds, packs with pnpm (so the dist/ exports rewrite
# is applied), then publishes the tarball with npm, whose browser passkey 2FA approval
# pnpm publish cannot do. release.yml publishes through trusted publishing, so this is for
# a new plugin's first release (npm configures a trusted publisher only for a package that
# exists) and a manual fallback. After a successful publish it creates and pushes the
# @scope/name@version git tag, which triggers release-notes.yml to create the GitHub release.
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
# publishes carry no provenance; release.yml's trusted publishing adds it.
cp package.json .package.json.orig
trap 'mv -f .package.json.orig package.json 2>/dev/null || true' EXIT
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); if (p.publishConfig) delete p.publishConfig.provenance; fs.writeFileSync('package.json', JSON.stringify(p, null, '\t') + '\n');"

pnpm pack >/dev/null
tgz="$(ls ./*.tgz | head -1)"

# main owns `latest`, beta versions included, the same as release.yml. npm refuses a
# prerelease without an explicit --tag, so name it.
echo "publishing $tgz (dist-tag: latest); approve the 2FA in your browser when it opens..."
npm publish "$tgz" --access public --tag latest
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
