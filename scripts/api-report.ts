/**
 * API reports for the published packages that opt in with `"apiReport": true` in their
 * package.json: one API Extractor report per `publishConfig.exports` entry that has `types`,
 * read from the built declarations and checked in under `<package>/api/`. A checked-in report
 * turns every change to the public surface into a reviewed diff, and `ae-forgotten-export`
 * fails an entry whose signatures reach a type it does not export.
 *
 * `pnpm api:check` (CI, after a build) fails on any report that would change, any missing or
 * orphaned report, any forgotten export, and any docs entry points page the checked-in reports
 * no longer generate (`scripts/docs-entry-points.ts`). `pnpm api:update` rewrites the reports
 * after an intended change, then the pages. Pass `--only-built` to skip packages with no `dist/`,
 * as `check:dist` does, and their pages, which read each entry's built module for its values.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	Extractor,
	ExtractorConfig,
	ExtractorLogLevel,
	type IConfigFile,
} from '@microsoft/api-extractor'
import { reportNameOf, syncEntryPointPages } from './docs-entry-points'

const REPO_ROOT = process.cwd()
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const REPORT_DIR = 'api'
const REPORT_SUFFIX = '.api.md'

interface PackageJson {
	name: string
	apiReport?: boolean
	publishConfig?: { exports?: Record<string, unknown> }
}

interface Entry {
	/** The subpath as published: `.`, `./client`, `./adapters/native`. */
	subpath: string
	/** Report base name: `index`, `client`, `adapters-native`. */
	report: string
	types: string
}

const typesOf = (target: unknown): string | undefined => {
	if (target && typeof target === 'object' && 'types' in target) {
		const { types } = target
		return typeof types === 'string' ? types : undefined
	}
	return undefined
}

const entriesOf = (pkg: PackageJson): Entry[] =>
	Object.entries(pkg.publishConfig?.exports ?? {}).flatMap(([subpath, target]) => {
		const types = typesOf(target)
		if (!types) return []
		return [{ subpath, report: reportNameOf(subpath), types }]
	})

/**
 * The extractor config for one entry, in memory. The compiler sees only the entry's declaration
 * file and what it imports, resolved the way a consumer's bundler resolves the package.
 */
const configFor = (pkgDir: string, entry: Entry, tempDir: string): IConfigFile => {
	const mainEntryPointFilePath = join(pkgDir, entry.types)
	return {
		projectFolder: pkgDir,
		mainEntryPointFilePath,
		bundledPackages: [],
		newlineKind: 'lf',
		compiler: {
			overrideTsconfig: {
				compilerOptions: {
					target: 'ES2022',
					module: 'ESNext',
					moduleResolution: 'bundler',
					lib: ['ES2023', 'DOM', 'DOM.Iterable'],
					jsx: 'react-jsx',
					strict: true,
					skipLibCheck: true,
					types: ['node'],
					// A workspace dependency stays at its node_modules path, as an installed one would,
					// so it is analyzed as an external package rather than as this package's own source.
					preserveSymlinks: true,
				},
				files: [mainEntryPointFilePath],
			},
		},
		apiReport: {
			enabled: true,
			reportFileName: entry.report,
			reportFolder: join(pkgDir, REPORT_DIR),
			reportTempFolder: tempDir,
		},
		docModel: { enabled: false },
		dtsRollup: { enabled: false },
		tsdocMetadata: { enabled: false },
		// `prepare` merges none of API Extractor's defaults, and an unlisted message is dropped, so
		// every rule that should report is spelled out here.
		messages: {
			compilerMessageReporting: { default: { logLevel: ExtractorLogLevel.Warning } },
			extractorMessageReporting: {
				default: { logLevel: ExtractorLogLevel.Warning },
				'ae-forgotten-export': { logLevel: ExtractorLogLevel.Error, addToApiReportFile: false },
				'ae-incompatible-release-tags': {
					logLevel: ExtractorLogLevel.Warning,
					addToApiReportFile: true,
				},
				'ae-internal-mixed-release-tag': {
					logLevel: ExtractorLogLevel.Warning,
					addToApiReportFile: true,
				},
				'ae-missing-release-tag': { logLevel: ExtractorLogLevel.None },
				// `@internal` marks component paths an import map resolves by name, which cannot take an underscore.
				'ae-internal-missing-underscore': { logLevel: ExtractorLogLevel.None },
				'ae-undocumented': { logLevel: ExtractorLogLevel.None },
				// No doc model is published, so doc comments and their links are not part of the contract.
				'ae-unresolved-link': { logLevel: ExtractorLogLevel.None },
				'ae-wrong-input-file-type': { logLevel: ExtractorLogLevel.Error },
			},
			tsdocMessageReporting: { default: { logLevel: ExtractorLogLevel.None } },
		},
	}
}

const reportPackage = (pkgDir: string, pkg: PackageJson, update: boolean): string[] => {
	const failures: string[] = []
	const tempDir = mkdtempSync(join(tmpdir(), 'api-report-'))
	const entries = entriesOf(pkg)
	const reportDir = join(pkgDir, REPORT_DIR)
	if (update) mkdirSync(reportDir, { recursive: true })
	try {
		for (const entry of entries) {
			if (!existsSync(join(pkgDir, entry.types))) {
				failures.push(`${entry.subpath}: ${entry.types} is missing, run the build first`)
				continue
			}
			const extractorConfig = ExtractorConfig.prepare({
				configObject: configFor(pkgDir, entry, tempDir),
				configObjectFullPath: undefined,
				packageJsonFullPath: join(pkgDir, 'package.json'),
			})
			const result = Extractor.invoke(extractorConfig, {
				localBuild: update,
				printApiReportDiff: !update,
				messageCallback: (message) => {
					if (message.logLevel === ExtractorLogLevel.Info) message.handled = true
					// A workspace dependency's `types` condition points at its TypeScript sources, which an
					// installed copy never ships; this package's own inputs are still held to `.d.ts`.
					if (
						message.messageId === 'ae-wrong-input-file-type' &&
						/[\\/]node_modules[\\/]/.test(message.sourceFilePath ?? '')
					) {
						message.logLevel = ExtractorLogLevel.None
						message.handled = true
					}
				},
			})
			if (!result.succeeded) {
				const problems = [
					...(result.errorCount > 0 ? [`${result.errorCount} error(s)`] : []),
					...(!update && result.apiReportChanged ? ['report differs from the checked-in one'] : []),
				]
				failures.push(`${entry.subpath}: ${problems.join(', ') || 'see the warnings above'}`)
			}
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true })
	}

	const expected = new Set(entries.map((entry) => `${entry.report}${REPORT_SUFFIX}`))
	const orphans = existsSync(reportDir)
		? readdirSync(reportDir).filter((file) => file.endsWith(REPORT_SUFFIX) && !expected.has(file))
		: []
	for (const orphan of orphans) {
		if (update) {
			rmSync(join(reportDir, orphan))
			console.log(`  removed ${REPORT_DIR}/${orphan} (no entry publishes it any more)`)
		} else {
			failures.push(`${REPORT_DIR}/${orphan} belongs to no published entry`)
		}
	}
	return failures
}

const main = (): void => {
	const args = process.argv.slice(2)
	const update = args.includes('--update')
	const onlyBuilt = args.includes('--only-built')
	let failed = false
	for (const name of readdirSync(PACKAGES_DIR).sort()) {
		const pkgDir = join(PACKAGES_DIR, name)
		const manifest = join(pkgDir, 'package.json')
		if (!existsSync(manifest)) continue
		const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as PackageJson
		if (pkg.apiReport !== true) continue
		if (onlyBuilt && !existsSync(join(pkgDir, 'dist'))) {
			console.log(`  skip ${name} (no dist, outside this run's affected scope)`)
			continue
		}
		const failures = reportPackage(pkgDir, pkg, update)
		if (failures.length === 0) {
			console.log(`  ok   ${name}`)
		} else {
			failed = true
			console.error(`  FAIL ${name}`)
			for (const failure of failures) console.error(`       ${failure}`)
		}
	}
	const stalePages = syncEntryPointPages(update, onlyBuilt)
	for (const page of stalePages) {
		console.error(`  FAIL ${page}`)
	}
	if (stalePages.length === 0) {
		console.log('  ok   docs entry points pages')
	}
	if (failed || stalePages.length > 0) {
		console.error(
			[
				'',
				...(failed
					? [
							'A forgotten export: export the type from that entry, with a release tag, or keep the signature from reaching it.',
						]
					: []),
				...(update
					? []
					: [
							'A changed report or a stale entry points page: if the change is intended, run `pnpm api:update` and commit the reports and the pages.',
						]),
			].join('\n')
		)
		process.exit(1)
	}
}

main()
