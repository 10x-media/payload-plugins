#!/usr/bin/env node
// Prints the release-notes body for one version from a package CHANGELOG.md: the
// content under `## <version>` up to the next `## ` heading. Used by the Release
// Notes workflow to build a GitHub release body. No dependencies so CI can run it
// with a bare node.
import { readFileSync } from 'node:fs'

const [, , changelogPath, version] = process.argv
if (!changelogPath || !version) {
	console.error('usage: changelog-section.mjs <CHANGELOG.md> <version>')
	process.exit(2)
}

const lines = readFileSync(changelogPath, 'utf8').split('\n')
const start = lines.findIndex((line) => line.trim() === `## ${version}`)

// Fall back to a minimal body so a release is still created even if the changelog
// entry is missing (e.g. a hand-cut tag).
if (start === -1) {
	process.stdout.write(`Release ${version}\n`)
	process.exit(0)
}

let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
	// `### Minor Changes` stays in the body; only the next version header ends it.
	if (/^##\s/.test(lines[i])) {
		end = i
		break
	}
}

const body = lines
	.slice(start + 1, end)
	.join('\n')
	.trim()
process.stdout.write(`${body || `Release ${version}`}\n`)
