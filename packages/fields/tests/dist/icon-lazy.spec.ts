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
})
