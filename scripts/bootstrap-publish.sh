#!/usr/bin/env bash
set -euo pipefail

# One-time interactive bootstrap publish for a plugin. Builds, packs with pnpm (so the
# dist/ exports rewrite is applied), then publishes the tarball with npm, whose browser
# passkey 2FA approval pnpm publish cannot do. Use only for a plugin's first publish;
# after that, CI plus OIDC trusted publishing handle releases automatically.
#
#   Usage: bash scripts/bootstrap-publish.sh <plugin>     (e.g. jobs)
#
# Prereqs: run `npm login` as the account that owns @10x-media, with 2FA set up.

plugin="${1:?usage: bash scripts/bootstrap-publish.sh <plugin>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/packages/$plugin"
[ -d "$dir" ] || { echo "error: no plugin at packages/$plugin" >&2; exit 1; }

echo "npm account: $(npm whoami 2>/dev/null || echo 'NOT LOGGED IN (run: npm login)')"
( cd "$root" && pnpm build "$plugin" )

cd "$dir"
rm -f ./*.tgz

# publishConfig.provenance forces provenance generation, which only works on a CI OIDC
# provider and overrides env vars and flags. Strip it from the manifest for this local
# bootstrap (kept through pack and publish), then restore. CI releases still get
# provenance via NPM_CONFIG_PROVENANCE in the workflows.
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
echo "done. verify with: npm view @10x-media/$plugin version"
