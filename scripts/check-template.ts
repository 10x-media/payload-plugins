/**
 * Template parity check for the files every plugin is supposed to carry verbatim.
 *
 * `tooling/plugin-template` is copied once at `pnpm new` and then never looked at again,
 * so a fix applied to the generated packages does not reach it: the production-build guard
 * in `dev/helpers/memoryDb.ts` diverged that way for six weeks and every plugin scaffolded
 * in between spawned a mongod during `next build`. This turns that class of drift into a
 * failing check on the pull request that introduces it.
 *
 * Only files listed in TRACKED are compared. Most of the template is a starting point that
 * each plugin is expected to rewrite (`src/index.ts`, translations, tests, package.json);
 * listing those would be noise. Add a file here once it is genuinely meant to stay
 * identical everywhere.
 *
 * Run standalone via `pnpm check:template` or in CI.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const TEMPLATE_DIR = join(REPO_ROOT, 'tooling/plugin-template/template')

/** Paths relative to a package root, each mirrored at `<TEMPLATE_DIR>/<path>.tmpl`. */
const TRACKED = [
	'dev/app/(payload)/admin/[[...segments]]/not-found.tsx',
	'dev/app/(payload)/admin/[[...segments]]/page.tsx',
	'dev/app/(payload)/api/[...slug]/route.ts',
	'dev/app/(payload)/api/graphql-playground/route.ts',
	'dev/app/(payload)/api/graphql/route.ts',
	'dev/app/(payload)/layout.tsx',
	'dev/helpers/memoryDb.ts',
	'dev/next.config.ts',
	'src/plugin/registerTranslations.ts',
	'src/translations/useTranslation.ts',
]

// A tracked file is compared byte for byte, so it cannot carry `{{token}}` substitutions.
const PLACEHOLDER_RE = /\{\{[^}]*\}\}/

const packageNames = (): string[] =>
	readdirSync(PACKAGES_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()

const problems: string[] = []

for (const tracked of TRACKED) {
	const templatePath = join(TEMPLATE_DIR, `${tracked}.tmpl`)

	if (!existsSync(templatePath)) {
		problems.push(`${tracked}\n  missing from the template at ${templatePath}`)
		continue
	}

	const expected = readFileSync(templatePath, 'utf8')

	if (PLACEHOLDER_RE.test(expected)) {
		problems.push(
			`${tracked}\n  the template copy contains a {{placeholder}}, so it cannot be tracked here.` +
				'\n  Either drop the placeholder or remove the file from TRACKED in scripts/check-template.ts.'
		)
		continue
	}

	for (const name of packageNames()) {
		const packagePath = join(PACKAGES_DIR, name, tracked)

		if (!existsSync(packagePath)) {
			problems.push(`${tracked}\n  packages/${name} is missing it`)
			continue
		}

		if (readFileSync(packagePath, 'utf8') !== expected) {
			problems.push(`${tracked}\n  packages/${name} has drifted from the template`)
		}
	}
}

if (problems.length > 0) {
	console.error(`Template drift (${problems.length}):\n`)
	for (const problem of problems) console.error(`  ${problem}\n`)
	console.error(
		'Every file above is meant to be byte-identical in the template and in all packages.'
	)
	console.error('Fix the template first, then copy it over the packages that differ.')
	process.exit(1)
}

console.log(
	`Template parity OK: ${TRACKED.length} files match across ${packageNames().length} packages.`
)
