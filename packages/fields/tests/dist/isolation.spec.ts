import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
const hasDist = existsSync(distDir)

// biome-ignore lint/plugin/noProcessEnv: test entry env boundary
if (process.env.REQUIRE_DIST === '1' && !hasDist) {
	throw new Error('dist/ not found. Run `pnpm build fields` before `pnpm --filter @10x-media/fields test:dist`.')
}

type Family = 'color' | 'icon' | 'encrypted' | 'measurement'

const familyEntries: Record<Family, string[]> = {
	color: ['exports/color.js', 'exports/color-utils.js'],
	icon: [
		'exports/icon.js',
		'exports/icon-react.js',
		'exports/icon-codegen.js',
		'exports/icon-adapters/lucide.js',
		'exports/icon-adapters/radix.js',
		'exports/icon-adapters/tabler.js',
	],
	encrypted: ['exports/encrypted.js'],
	measurement: ['exports/measurement.js', 'exports/measurement-utils.js'],
}

const sharedEntries = [
	'index.js',
	'exports/types.js',
	'exports/client.js',
	'exports/rsc.js',
	'exports/i18n.js',
]

const allFamilies: Family[] = ['color', 'icon', 'encrypted', 'measurement']

/** Families whose engine has landed under dist/fields/<family>; grows as families ship. */
const familiesWithSource: Family[] = allFamilies

const familyPrefix = (family: Family): string => join(distDir, 'fields', family) + sep

const IMPORT_RE =
	/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

const relativeSpecifiers = (source: string): string[] => {
	const out: string[] = []
	for (const match of source.matchAll(IMPORT_RE)) {
		const spec = match[1] ?? match[2] ?? match[3]
		if (spec?.startsWith('.')) {
			out.push(spec)
		}
	}
	return out
}

const resolveSpecifier = (fromFile: string, spec: string): string | undefined => {
	if (spec.endsWith('.css')) {
		return undefined
	}
	const resolved = normalize(join(dirname(fromFile), spec))
	if (existsSync(resolved) && resolved.endsWith('.js')) {
		return resolved
	}
	if (existsSync(`${resolved}.js`)) {
		return `${resolved}.js`
	}
	const asIndex = join(resolved, 'index.js')
	if (existsSync(asIndex)) {
		return asIndex
	}
	throw new Error(`Cannot resolve import '${spec}' from ${fromFile}`)
}

/** Transitive relative-import closure of a dist entry, as absolute file paths. */
const importGraph = (entry: string): Set<string> => {
	const visited = new Set<string>()
	const queue = [join(distDir, entry)]
	while (queue.length > 0) {
		const file = queue.pop()
		if (file === undefined || visited.has(file)) {
			continue
		}
		visited.add(file)
		const source = readFileSync(file, 'utf8')
		for (const spec of relativeSpecifiers(source)) {
			const resolved = resolveSpecifier(file, spec)
			if (resolved !== undefined && !visited.has(resolved)) {
				queue.push(resolved)
			}
		}
	}
	return visited
}

describe.skipIf(!hasDist)('dist bundle isolation', () => {
	it('every published entry exists in dist', () => {
		const entries = [...sharedEntries, ...allFamilies.flatMap((family) => familyEntries[family])]
		for (const entry of entries) {
			expect(existsSync(join(distDir, entry)), `missing dist entry ${entry}`).toBe(true)
		}
	})

	for (const family of allFamilies) {
		const forbidden = allFamilies.filter((other) => other !== family)
		for (const entry of familyEntries[family]) {
			it(`${entry} never reaches ${forbidden.join(' or ')} code`, () => {
				const graph = importGraph(entry)
				const offenders = [...graph].filter((file) =>
					forbidden.some((other) => file.startsWith(familyPrefix(other)))
				)
				expect(offenders).toEqual([])
			})
		}
	}

	for (const family of familiesWithSource) {
		it(`${family} entries actually reach dist/fields/${family} code`, () => {
			const graph = new Set(familyEntries[family].flatMap((entry) => [...importGraph(entry)]))
			const reached = [...graph].filter((file) => file.startsWith(familyPrefix(family)))
			expect(reached.length, `no ${family} entry imports dist/fields/${family}, isolation checks are vacuous`).toBeGreaterThan(0)
		})
	}

	it('dist/fields children are a subset of the known families', () => {
		const fieldsDir = join(distDir, 'fields')
		const children = existsSync(fieldsDir) ? readdirSync(fieldsDir) : []
		const known = new Set<string>(allFamilies)
		expect(children.filter((child) => !known.has(child))).toEqual([])
	})

	it('client barrel graph never imports node:crypto', () => {
		const offenders = [...importGraph('exports/client.js')].filter((file) =>
			/['"]node:crypto['"]/.test(readFileSync(file, 'utf8'))
		)
		expect(offenders).toEqual([])
	})

	it('client barrel graph never imports the lexical editor package', () => {
		// The richText reveal gate is client, but the editor loads through the app
		// import map (server RSC delegation), never a static client import. A stray
		// import here would ship the whole editor into the client bundle.
		const offenders = [...importGraph('exports/client.js')].filter((file) =>
			/@payloadcms\/richtext-lexical/.test(readFileSync(file, 'utf8'))
		)
		expect(offenders).toEqual([])
	})

	it('rsc barrel graph reaches the lexical rsc entry (server-only delegation)', () => {
		const reached = [...importGraph('exports/rsc.js')].some((file) =>
			/@payloadcms\/richtext-lexical\/rsc/.test(readFileSync(file, 'utf8'))
		)
		expect(reached).toBe(true)
	})

	it('frontend-safe color utils stay dependency-free of admin code', () => {
		const offenders = [...importGraph('exports/color-utils.js')].filter(
			(file) =>
				file.startsWith(join(distDir, 'plugin') + sep) ||
				file.startsWith(join(distDir, 'translations') + sep)
		)
		expect(offenders).toEqual([])
	})

	it('frontend-safe measurement utils stay dependency-free of admin code', () => {
		const offenders = [...importGraph('exports/measurement-utils.js')].filter(
			(file) =>
				file.startsWith(join(distDir, 'plugin') + sep) ||
				file.startsWith(join(distDir, 'translations') + sep)
		)
		expect(offenders).toEqual([])
	})
})
