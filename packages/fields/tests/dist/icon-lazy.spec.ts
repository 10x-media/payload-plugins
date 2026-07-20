import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
const hasDist = existsSync(distDir)

// biome-ignore lint/plugin/noProcessEnv: test entry env boundary
if (process.env.REQUIRE_DIST === '1' && !hasDist) {
	throw new Error('dist/ not found. Run `pnpm build fields` before `pnpm --filter @10x-media/fields test:dist`.')
}

const ICON_PACKAGES = ['lucide-react', '@radix-ui/react-icons', '@tabler/icons-react']

const staticImportsOf = (source: string): string[] => {
	const specifiers: string[] = []
	const fromRe = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s+['"]([^'"]+)['"]/g
	const bareRe = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
	for (const re of [fromRe, bareRe]) {
		let match = re.exec(source)
		while (match) {
			if (match[1] !== undefined) specifiers.push(match[1])
			match = re.exec(source)
		}
	}
	return specifiers
}

/**
 * Walks the STATIC import graph from an entry inside dist; returns external
 * specifiers reached. Dynamic `import()` is deliberately not matched, so the
 * heavy icon chunks stay off this graph. Relative `.css` assets are skipped
 * (built JS carries bare `import "./x.css"` statements that are not JS modules).
 */
const collectExternals = (entry: string): Set<string> => {
	const externals = new Set<string>()
	const visited = new Set<string>()
	const queue = [entry]
	while (queue.length > 0) {
		const file = queue.pop() as string
		if (visited.has(file)) continue
		visited.add(file)
		if (!existsSync(file)) continue
		const source = readFileSync(file, 'utf8')
		for (const specifier of staticImportsOf(source)) {
			if (specifier.startsWith('.')) {
				if (specifier.endsWith('.css')) continue
				let resolved = resolve(dirname(file), specifier)
				if (!resolved.endsWith('.js')) resolved = `${resolved}.js`
				queue.push(resolved)
			} else {
				externals.add(specifier)
			}
		}
	}
	return externals
}

/** Static (non-dynamic) file closure of an entry, so dynamic `import()` chunks stay out. */
const collectStaticFiles = (entry: string): Set<string> => {
	const visited = new Set<string>()
	const queue = [entry]
	while (queue.length > 0) {
		const file = queue.pop() as string
		if (visited.has(file)) continue
		visited.add(file)
		if (!existsSync(file)) continue
		for (const specifier of staticImportsOf(readFileSync(file, 'utf8'))) {
			if (specifier.startsWith('.') && !specifier.endsWith('.css')) {
				let resolved = resolve(dirname(file), specifier)
				if (!resolved.endsWith('.js')) resolved = `${resolved}.js`
				queue.push(resolved)
			}
		}
	}
	return visited
}

describe.skipIf(!hasDist)('icon family dist laziness', () => {
	it('dist exists (run pnpm build fields first)', () => {
		expect(readdirSync(distDir).length).toBeGreaterThan(0)
	})

	it('the icon factory entry never statically imports icon packages or react-virtual', () => {
		const externals = collectExternals(join(distDir, 'exports/icon.js'))
		for (const pkg of [...ICON_PACKAGES, '@tanstack/react-virtual']) {
			expect([...externals].some((entry) => entry.startsWith(pkg))).toBe(false)
		}
	})

	it('the frontend renderer entry never statically imports icon packages', () => {
		const externals = collectExternals(join(distDir, 'exports/icon-react.js'))
		for (const pkg of ICON_PACKAGES) {
			expect([...externals].some((entry) => entry.startsWith(pkg))).toBe(false)
		}
	})

	it('adapter entries never statically import their icon package or generated modules', () => {
		for (const slug of ['lucide', 'radix', 'tabler']) {
			const entry = join(distDir, `exports/icon-adapters/${slug}.js`)
			const externals = collectExternals(entry)
			for (const pkg of ICON_PACKAGES) {
				expect([...externals].some((specifier) => specifier.startsWith(pkg))).toBe(false)
			}
			const visitedGenerated = [...collectExternals(entry)].some((specifier) =>
				specifier.includes('/generated/')
			)
			expect(visitedGenerated).toBe(false)
		}
	})

	it('the client barrel never statically imports icon packages', () => {
		const externals = collectExternals(join(distDir, 'exports/client.js'))
		for (const pkg of ICON_PACKAGES) {
			expect([...externals].some((entry) => entry.startsWith(pkg))).toBe(false)
		}
	})

	it('bulk node-data is emitted for the node-rendered libraries', () => {
		// Guards the dynamic-only assertion below from passing vacuously if the build stops
		// emitting node-data. Radix intentionally has none (renders through the Icon path).
		for (const slug of ['lucide', 'tabler']) {
			expect(existsSync(join(distDir, `fields/icon/adapters/${slug}/generated/nodes.js`))).toBe(true)
		}
	})

	it('node-data is only reachable by dynamic import, never in a static graph', () => {
		// The heavy node-data (hundreds of KB per library) must load lazily inside the drawer
		// chunk, so no eager frontend, adapter, or barrel entry may statically reach it.
		const entries = [
			'exports/icon.js',
			'exports/icon-react.js',
			'exports/client.js',
			'exports/rsc.js',
			'exports/icon-adapters/lucide.js',
			'exports/icon-adapters/tabler.js',
			'exports/icon-adapters/radix.js',
		]
		for (const entry of entries) {
			const files = collectStaticFiles(join(distDir, entry))
			const offenders = [...files].filter((file) => file.endsWith('/generated/nodes.js'))
			expect(offenders, `${entry} statically reaches node-data`).toEqual([])
		}
	})
})
