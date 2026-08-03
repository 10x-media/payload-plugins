import { getFromImportMap } from 'payload/shared'
import { describe, expect, it } from 'vitest'
import type { IconAdapter } from '../../../types'
import { lucideAdapter } from './lucide/adapter'
import { radixAdapter } from './radix/adapter'
import { tablerAdapter } from './tabler/adapter'

/**
 * Every component path a bundled adapter declares must actually be exported from the
 * subpath it names.
 *
 * `getFromImportMap` is called with `silent: true`, deliberately, so a mis-registered
 * adapter degrades to no glyph instead of a 500. That makes a missing export invisible:
 * the drawer quietly falls back to the per-icon path and everything still looks fine. It
 * is only visible by measuring the rendered markup, which shipped once already.
 */
const barrels: Record<string, () => Promise<Record<string, unknown>>> = {
	'@10x-media/fields/icon/adapters/lucide': () => import('../../../exports/icon-adapters/lucide'),
	'@10x-media/fields/icon/adapters/radix': () => import('../../../exports/icon-adapters/radix'),
	'@10x-media/fields/icon/adapters/tabler': () => import('../../../exports/icon-adapters/tabler'),
}

const declaredPaths = (adapter: IconAdapter): string[] =>
	[adapter.Icon, adapter.Assets, adapter.Nodes].filter((path): path is string => Boolean(path))

describe('bundled adapters declare only paths they export', () => {
	it.each([
		['lucide', lucideAdapter()],
		['radix', radixAdapter()],
		['tabler', tablerAdapter()],
	])('%s', async (_slug, adapter) => {
		for (const path of declaredPaths(adapter)) {
			const [specifier, exportName] = path.split('#')
			expect(specifier, `${path} has no export name`).toBeDefined()
			expect(exportName, `${path} has no export name`).toBeTruthy()
			const load = barrels[specifier ?? '']
			expect(load, `no barrel mapped for ${specifier}`).toBeDefined()
			const module = await load?.()
			expect(module?.[exportName ?? ''], `${specifier} does not export ${exportName}`).toBeDefined()
		}
	})

	// A library with node-data must declare where to load it, or the drawer silently
	// renders through the per-icon path and the bulk fast path is dead weight.
	it.each([
		['lucide', lucideAdapter()],
		['radix', radixAdapter()],
		['tabler', tablerAdapter()],
	])('%s declares a Nodes loader for its committed node-data', (_slug, adapter) => {
		expect(adapter.Nodes).toBeTruthy()
	})

	// Closes the loop the two cases above leave open: the adapter names a path, the barrel
	// exports it, and `getFromImportMap` actually finds it under a Payload-shaped map. That
	// last hop is what `IconFieldServer` performs, and it is the one that fails silently.
	it('resolves every declared path through a payload-shaped import map', async () => {
		const importMap: Record<string, unknown> = {}
		for (const [specifier, load] of Object.entries(barrels)) {
			const module = await load()
			for (const [exportName, value] of Object.entries(module)) {
				importMap[`${specifier}#${exportName}`] = value
			}
		}
		for (const adapter of [lucideAdapter(), radixAdapter(), tablerAdapter()]) {
			for (const path of declaredPaths(adapter)) {
				const resolved = getFromImportMap<unknown>({
					importMap: importMap as never,
					PayloadComponent: path,
					silent: true,
				})
				expect(resolved, `${adapter.slug}: import map has no entry for ${path}`).toBeDefined()
			}
		}
	})
})
