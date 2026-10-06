import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectExternals, collectStaticFiles, distDir, hasDist } from './importGraph'

const ICON_PACKAGES = ['lucide-react', '@radix-ui/react-icons', '@tabler/icons-react']

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
