/**
 * The docs' entry points reference pages, generated from the API reports `scripts/api-report.ts`
 * keeps under `<package>/api/`: one list per published entry of every export it has, grouped by
 * release tag, beside the prose below that says where each entry may be imported from. An export
 * is listed as a value only when the entry's built module exports it, so a type-only re-export of
 * a constant reads as the type it is.
 *
 * `pnpm api:check` fails on a page that differs from what the reports generate, and
 * `pnpm api:update` rewrites it after rewriting the reports. Both need the package built; with
 * `--only-built` a package without `dist/` is skipped. Run alone, this checks the pages, or
 * rewrites them with `--update`.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

type ReleaseTag = 'public' | 'beta' | 'internal' | 'alpha' | 'deprecated'

interface ReportExport {
	name: string
	tag: ReleaseTag
}

interface ListedExport extends ReportExport {
	/** Exported by the entry's built module: a function, class or constant rather than a type. */
	value: boolean
}

interface EntryProse {
	/** The report's base name under `api/`: `index`, `adapters-native`. */
	report: string
	specifier: string
	/** Where it may be imported from, and what it loads. */
	where: string
	/** What it exports, in a sentence or two. */
	what: string
}

interface EntryPointsPage {
	/** The package directory, relative to the repository root. */
	packageDir: string
	/** The page, relative to the repository root. */
	page: string
	/** The reports whose shared exports are listed once, as the adapter contract types. */
	contractReports: readonly string[]
	entries: readonly EntryProse[]
	head: readonly string[]
	stylesheetRow: string
}

const RELEASE_TAGS: Readonly<Record<string, ReleaseTag>> = {
	public: 'public',
	beta: 'beta',
	internal: 'internal',
	alpha: 'alpha',
}

const TAG_LINE = /^\/\/ @(public|beta|internal|alpha)\b(.*)$/
const DECLARATION =
	/^(export )?(?:declare )?(?:abstract )?(?:class|interface|type|const|function|enum|namespace|let|var) ([A-Za-z_$][\w$]*)/
const REEXPORT = /^export \{ ([\w$]+)(?: as ([\w$]+))? \}/

/** Every export of one API report, with its release tag. */
export const parseReport = (text: string): ReportExport[] => {
	const tags = new Map<string, ReleaseTag>()
	const exported = new Map<string, string>()
	let tag: ReleaseTag | null = null
	for (const line of text.split('\n')) {
		const tagged = line.match(TAG_LINE)
		if (tagged) {
			const [, release = 'public', rest = ''] = tagged
			tag = rest.includes('@deprecated') ? 'deprecated' : (RELEASE_TAGS[release] ?? 'public')
			continue
		}
		const declared = line.match(DECLARATION)
		if (declared) {
			const [, isExported, name = ''] = declared
			if (tag && !tags.has(name)) tags.set(name, tag)
			if (isExported) exported.set(name, name)
			tag = null
			continue
		}
		const reexported = line.match(REEXPORT)
		if (reexported) {
			const [, source = '', alias] = reexported
			exported.set(alias ?? source, source)
		}
	}
	return [...exported]
		.map(([name, source]) => ({ name, tag: tags.get(source) ?? 'public' }))
		.sort((a, b) => a.name.localeCompare(b.name))
}

const EXPORT_LIST = /\bexport\s*\{([^}]*)\}/g
const EXPORT_DECLARED =
	/^export\s+(?:async\s+)?(?:const|let|var|class|function\*?)\s+([A-Za-z_$][\w$]*)/gm
const EXPORT_STAR = /^export\s*\*/m

/** The names a built ES module exports, read from its `export` statements. */
export const parseModuleExports = (source: string): Set<string> => {
	if (EXPORT_STAR.test(source)) {
		throw new Error('a built entry re-exports with `export *`, whose names cannot be listed')
	}
	const names = new Set<string>()
	for (const [, list = ''] of source.matchAll(EXPORT_LIST)) {
		for (const item of list.split(',')) {
			const [local = '', alias] = item.trim().split(/\s+as\s+/)
			const name = (alias ?? local).trim()
			if (name !== '') names.add(name)
		}
	}
	for (const [, name = ''] of source.matchAll(EXPORT_DECLARED)) {
		names.add(name)
	}
	return names
}

/** A published subpath's report base name: `.` is `index`, `./adapters/native` is `adapters-native`. */
export const reportNameOf = (subpath: string): string =>
	subpath === '.' ? 'index' : subpath.replace(/^\.\//, '').replaceAll('/', '-')

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const stringAt = (value: object, key: string): string | undefined => {
	const found: unknown = Reflect.get(value, key)
	return typeof found === 'string' ? found : undefined
}

/** What each published entry's built module exports, by report base name; undefined while unbuilt. */
const runtimeExportsOf = (packageDir: string): Map<string, Set<string>> | undefined => {
	const root = join(REPO_ROOT, packageDir)
	const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
	const publishConfig: unknown = isObject(manifest)
		? Reflect.get(manifest, 'publishConfig')
		: undefined
	const exportsField: unknown = isObject(publishConfig)
		? Reflect.get(publishConfig, 'exports')
		: undefined
	if (!isObject(exportsField)) {
		throw new Error(`${packageDir}/package.json has no publishConfig.exports`)
	}
	const modules = new Map<string, Set<string>>()
	for (const [subpath, target] of Object.entries(exportsField)) {
		if (!isObject(target) || stringAt(target, 'types') === undefined) continue
		const file = stringAt(target, 'import') ?? stringAt(target, 'default')
		if (file === undefined) continue
		const path = join(root, file)
		if (!existsSync(path)) return undefined
		modules.set(reportNameOf(subpath), parseModuleExports(readFileSync(path, 'utf8')))
	}
	return modules
}

const reportsOf = (packageDir: string): Map<string, ReportExport[]> => {
	const dir = join(REPO_ROOT, packageDir, 'api')
	const reports = new Map<string, ReportExport[]>()
	for (const file of readdirSync(dir)
		.filter((name) => name.endsWith('.api.md'))
		.sort()) {
		reports.set(file.replace(/\.api\.md$/, ''), parseReport(readFileSync(join(dir, file), 'utf8')))
	}
	return reports
}

const code = (names: readonly string[]): string => names.map((name) => `\`${name}\``).join(', ')

/** The anchor fumadocs gives a heading that is the entry's specifier in backticks. */
const anchorOf = (specifier: string): string => specifier.toLowerCase().replace(/[^\w\- ]/g, '')

/** The page as the reports generate it, each export a value only where `modules` says so. */
export const renderEntryPoints = (
	page: EntryPointsPage,
	modules: ReadonlyMap<string, ReadonlySet<string>>
): string => {
	const reports = reportsOf(page.packageDir)
	const reportOf = (name: string): ListedExport[] => {
		const report = reports.get(name)
		const runtime = modules.get(name)
		if (!report) {
			throw new Error(`${page.packageDir}/api has no ${name}.api.md`)
		}
		if (!runtime) {
			throw new Error(`${page.packageDir} publishes no built module for the ${name} report`)
		}
		return report.map((each) => ({ ...each, value: runtime.has(each.name) }))
	}
	const contractSets = page.contractReports.map(
		(name) => new Set(reportOf(name).map((each) => each.name))
	)
	const [firstContract = new Set<string>()] = contractSets
	const contract = [...firstContract]
		.filter((name) => contractSets.every((set) => set.has(name)))
		.sort((a, b) => a.localeCompare(b))
	const inContract = new Set(contract)

	const lines: string[] = [...page.head, '', '| Entry | Import it from |', '|---|---|']
	for (const entry of page.entries) {
		lines.push(`| [\`${entry.specifier}\`](#${anchorOf(entry.specifier)}) | ${entry.where} |`)
	}
	lines.push(
		page.stylesheetRow,
		'',
		"Each list below is the entry's whole public surface, as the API reports in the package's repository record it. **Stable** exports keep their names within a major release; **beta** ones may change in a minor; **internal** ones are exported only because Payload's import map names them, so do not import them ([Stability](/analytics/reference/stability#release-tags)).",
		'',
		'## The adapter contract types',
		'',
		`The adapter entries, \`/next\` and \`/testing\` each also export the types an adapter is written against, the constants among them as types only, all of them stable and all also exported from \`@10x-media/analytics/types\`, which exports the constants as values: ${code(contract)}.`,
		''
	)
	for (const entry of page.entries) {
		const all = reportOf(entry.report)
		const hasContract = contract.every((name) => all.some((each) => each.name === name))
		const own = hasContract ? all.filter((each) => !inContract.has(each.name)) : all
		lines.push(`## \`${entry.specifier}\``, '', `**Where:** ${entry.where}`, '', entry.what, '')
		const groups: Array<[string, ListedExport[]]> = [
			['Stable values', own.filter((each) => each.tag === 'public' && each.value)],
			['Stable types', own.filter((each) => each.tag === 'public' && !each.value)],
			['Beta', own.filter((each) => each.tag === 'beta')],
			['Deprecated', own.filter((each) => each.tag === 'deprecated')],
			['Internal', own.filter((each) => each.tag === 'internal')],
		]
		for (const [label, items] of groups) {
			if (items.length > 0) {
				lines.push(`- **${label}:** ${code(items.map((each) => each.name))}`)
			}
		}
		if (hasContract) {
			lines.push('- **Also:** [the adapter contract types](#the-adapter-contract-types).')
		}
		lines.push('')
	}
	return `${lines.join('\n').trimEnd()}\n`
}

const ANALYTICS: EntryPointsPage = {
	packageDir: 'packages/analytics',
	page: 'apps/docs/content/docs/analytics/reference/entry-points.mdx',
	contractReports: [
		'adapters-ga4',
		'adapters-native',
		'adapters-plausible',
		'adapters-posthog',
		'adapters-umami',
	],
	head: [
		'---',
		'title: Entry points',
		'description: Every import path the package exports, where each may be imported, and what it exports, by release tag.',
		'---',
		'',
		'The package splits its exports by where they run, so a page loads only what it needs and a server module never pulls the admin UI in. Import from the entry that matches where your code runs:',
	],
	stylesheetRow:
		"| `@10x-media/analytics/styles.css` | Anywhere that draws `BarList` or `TrendChart` outside the admin, where your bundler does not follow the package's own stylesheet imports ([Customizing](/analytics/customizing#outside-the-admin)). |",
	entries: [
		{
			report: 'index',
			specifier: '@10x-media/analytics',
			where:
				"Your Payload config and server code: route handlers, jobs, scripts, Payload's CLI. It loads Payload and no React, admin UI or stylesheet.",
			what: 'The plugin, its options and their types, the field factories, `goalField` and `trackGoalAction`, server tracking (`trackServerEvent`, `purchase`, `refund`), the server reads and `SYSTEM`, the provider collection helpers, `rebuildDays`, the collection slugs and the error builders.',
		},
		{
			report: 'types',
			specifier: '@10x-media/analytics/types',
			where:
				'Anywhere. Its few runtime values (constants and `readErrorCode`) load no package, and its types erase.',
			what: "The types of every public shape: the adapter contract, the options, the endpoints' requests and answers, the read results, plus the key lists the pickers are built from.",
		},
		{
			report: 'attributes',
			specifier: '@10x-media/analytics/attributes',
			where:
				'Anywhere, the browser and server components included. It loads no package and no stylesheet.',
			what: 'The `data-analytics-*` attribute names and the helpers that spread them into your markup: [goals](/analytics/integrations), [content items](/analytics/items).',
		},
		{
			report: 'tracker',
			specifier: '@10x-media/analytics/tracker',
			where:
				'The browser. It loads no package and no stylesheet: no React, no Payload, no Node built-ins.',
			what: 'The [browser tracker](/analytics/reference/tracker) for a page that boots it without React.',
		},
		{
			report: 'react',
			specifier: '@10x-media/analytics/react',
			where: "Client components of your site (`'use client'`). It loads React alone.",
			what: '`AnalyticsProvider` and `useAnalytics`, the tracker from React ([Tracker](/analytics/reference/tracker#react)).',
		},
		{
			report: 'site',
			specifier: '@10x-media/analytics/site',
			where:
				'Server components of your site, such as its root layout. It loads React and Payload, and no admin module.',
			what: "`AnalyticsScripts` and `getTrackerConfig`, which render the tracker with the request's config ([Tracker](/analytics/reference/tracker#server-render)).",
		},
		{
			report: 'rsc',
			specifier: '@10x-media/analytics/rsc',
			where: "Server components of the admin. It loads Payload's admin UI and the stylesheet.",
			what: 'The view and widget server components, the widget card family, the server field wrappers, and the read helpers the package root also exports.',
		},
		{
			report: 'client',
			specifier: '@10x-media/analytics/client',
			where:
				"Client components of the admin (`'use client'`). It loads Payload's admin UI, Next's navigation and the stylesheet.",
			what: "The charts, the pickers, `fetchQuery` and `refreshCache`, the error readers, and the analytics view's sections for [`view.Component`](/analytics/customizing#the-analytics-views-body).",
		},
		{
			report: 'i18n',
			specifier: '@10x-media/analytics/i18n',
			where: 'Anywhere. It loads no package.',
			what: 'The translation keys and the built-in strings ([Translations](/analytics/reference/translations)).',
		},
		{
			report: 'geo',
			specifier: '@10x-media/analytics/geo',
			where:
				'Server code, in your Payload config. It loads no package until a MaxMind lookup needs one.',
			what: 'The [geo resolvers](/analytics/geo#custom-pipelines) for a pipeline of your own.',
		},
		{
			report: 'next',
			specifier: '@10x-media/analytics/next',
			where: 'Your Next.js route handlers. It loads Payload only when a route handler first runs.',
			what: "`captureRoute`, which relays a vendor through a [route handler of your own](/analytics/proxy#a-route-handler-of-your-own) by the first-party proxy's rules, and `ingestRoute` and `ingestPreflight` for [beacons in a route of your own](/analytics/capture#taking-beacons-in-a-route-of-your-own). `captureRewrites` and `posthogProxyRewrites` stay exported, deprecated, and throw when called: a Next rewrite forwards the visitor's cookies to the vendor.",
		},
		{
			report: 'migrations',
			specifier: '@10x-media/analytics/migrations',
			where: "Migration files, which Payload's CLI runs. It loads no package.",
			what: 'The helpers that remove what earlier releases stored ([Upgrading](/analytics/upgrading/beta-12)).',
		},
		{
			report: 'migrations-drop-legacy-mongo',
			specifier: '@10x-media/analytics/migrations/drop-legacy-mongo',
			where: "Payload's CLI, as `payload migrate:create --file`.",
			what: 'The predefined migration that removes the 1.0.0-beta.11 native storage on MongoDB.',
		},
		{
			report: 'testing',
			specifier: '@10x-media/analytics/testing',
			where: 'Tests.',
			what: "`memoryAdapter`, an in-memory adapter, and `settleAnalytics`, which waits for the plugin's background work ([Adapter contract](/analytics/reference/adapter-contract#testing-memoryadapter)).",
		},
		{
			report: 'adapters-native',
			specifier: '@10x-media/analytics/adapters/native',
			where: 'Your Payload config and server code. It loads Payload and Node built-ins.',
			what: "The [native engine](/analytics/native): `native()` and its options, `isBot`, the slugs and the maintenance task's name and input.",
		},
		{
			report: 'adapters-plausible',
			specifier: '@10x-media/analytics/adapters/plausible',
			where: 'Your Payload config. It loads no package.',
			what: '[Plausible](/analytics/providers#plausible).',
		},
		{
			report: 'adapters-umami',
			specifier: '@10x-media/analytics/adapters/umami',
			where: 'Your Payload config. It loads no package.',
			what: '[Umami](/analytics/providers#umami).',
		},
		{
			report: 'adapters-ga4',
			specifier: '@10x-media/analytics/adapters/ga4',
			where:
				'Your Payload config. It loads `@google-analytics/data` only when a read needs it and `sdks.ga4` does not hand it over.',
			what: '[GA4](/analytics/providers#ga4).',
		},
		{
			report: 'adapters-posthog',
			specifier: '@10x-media/analytics/adapters/posthog',
			where: 'Your Payload config. It loads no package.',
			what: '[PostHog](/analytics/providers#posthog).',
		},
	],
}

export const ENTRY_POINT_PAGES: readonly EntryPointsPage[] = [ANALYTICS]

/**
 * Checks each page against its reports, or rewrites it with `update`. Answers a line per stale
 * page, none after an update. A package whose reports are missing is skipped: its own report
 * check already fails. An unbuilt package is a failure, or skipped under `onlyBuilt`.
 */
export const syncEntryPointPages = (update: boolean, onlyBuilt = false): string[] => {
	const stale: string[] = []
	for (const page of ENTRY_POINT_PAGES) {
		if (!existsSync(join(REPO_ROOT, page.packageDir, 'api'))) {
			continue
		}
		const path = join(REPO_ROOT, page.page)
		const modules = runtimeExportsOf(page.packageDir)
		if (!modules) {
			if (onlyBuilt) {
				console.log(`  skip ${relative(REPO_ROOT, path)} (${page.packageDir} is not built)`)
			} else {
				stale.push(`${relative(REPO_ROOT, path)}: build ${page.packageDir} first`)
			}
			continue
		}
		const rendered = renderEntryPoints(page, modules)
		const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
		if (current === rendered) {
			continue
		}
		if (update) {
			writeFileSync(path, rendered)
			console.log(`  wrote ${relative(REPO_ROOT, path)}`)
		} else {
			stale.push(`${relative(REPO_ROOT, path)} differs from what ${page.packageDir}/api generates`)
		}
	}
	return stale
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const stale = syncEntryPointPages(
		process.argv.includes('--update'),
		process.argv.includes('--only-built')
	)
	for (const line of stale) console.error(`  FAIL ${line}`)
	if (stale.length > 0) {
		console.error('\nRun `pnpm api:update` to regenerate the pages from the reports.')
		process.exit(1)
	}
	console.log('  ok   entry points pages')
}
