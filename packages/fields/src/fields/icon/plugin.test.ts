import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import type { FieldsPluginRegistry } from '../../types'
import { lucideAdapter } from './adapters/lucide/adapter'
import { radixAdapter } from './adapters/radix/adapter'
import { registerIcon } from './plugin'

const registryOf = (config: Config): FieldsPluginRegistry =>
	(config.custom?.['@10x-media/fields'] ?? {}) as FieldsPluginRegistry

describe('registerIcon', () => {
	it('is a no-op without adapters', () => {
		const config = {} as Config
		registerIcon(config, undefined)
		expect(config.custom).toBeUndefined()
		registerIcon(config, { adapters: [] })
		expect(config.custom).toBeUndefined()
	})

	it('writes the registry and admin dependencies', () => {
		const config = {} as Config
		registerIcon(config, { adapters: [lucideAdapter(), radixAdapter()] })
		const registry = registryOf(config)
		expect(registry.icon?.defaultLibrary).toBe('lucide')
		expect(registry.icon?.adapters?.map((adapter) => adapter.slug)).toEqual(['lucide', 'radix'])
		expect(config.admin?.dependencies?.['fields-icon-lucide-Icon']).toEqual({
			path: '@10x-media/fields/icon/adapters/lucide#LucideAdapterIcon',
			type: 'component',
		})
		expect(config.admin?.dependencies?.['fields-icon-radix-Assets']).toEqual({
			path: '@10x-media/fields/icon/adapters/radix#RadixAdapterAssets',
			type: 'component',
		})
		// The optional Nodes loader is registered only when the adapter ships one, so a
		// generate:importmap keeps the drawer's bulk node-data path (lucide has it, radix does not).
		expect(config.admin?.dependencies?.['fields-icon-lucide-Nodes']).toEqual({
			path: '@10x-media/fields/icon/adapters/lucide#LucideAdapterNodes',
			type: 'component',
		})
		expect(config.admin?.dependencies?.['fields-icon-radix-Nodes']).toBeUndefined()
	})

	it('preserves registry slices written by other field families', () => {
		const config = {
			custom: { '@10x-media/fields': { color: { format: 'hex' } } },
		} as unknown as Config
		registerIcon(config, { adapters: [lucideAdapter()] })
		expect(registryOf(config).color).toEqual({ format: 'hex' })
		expect(registryOf(config).icon?.defaultLibrary).toBe('lucide')
	})

	it('rejects duplicate slugs and unknown defaultLibrary', () => {
		expect(() =>
			registerIcon({} as Config, { adapters: [lucideAdapter(), lucideAdapter()] })
		).toThrow('duplicate icon adapter slug')
		expect(() =>
			registerIcon({} as Config, { adapters: [lucideAdapter()], defaultLibrary: 'tabler' })
		).toThrow('defaultLibrary')
	})

	it('rejects slugs that would break the stored value round-trip', () => {
		for (const slug of ['my:lib', 'My-Lib', 'my lib', '', 'my_lib']) {
			expect(() =>
				registerIcon({} as Config, { adapters: [{ ...lucideAdapter(), slug }] })
			).toThrow('invalid icon adapter slug')
		}
		expect(() =>
			registerIcon({} as Config, { adapters: [{ ...lucideAdapter(), slug: 'my-lib-2' }] })
		).not.toThrow()
	})

	// Layer ids key the manifest cache, so a duplicate would make two layers share one
	// cached listing and silently serve the wrong one.
	it('rejects duplicate layer ids within one adapter', () => {
		const layered = {
			...lucideAdapter(),
			layers: [
				{
					id: 'base',
					loadManifest: async () => ({ categories: [], icons: [] }),
					render: { Icon: 'x#I', type: 'component' as const },
				},
				{
					id: 'base',
					loadManifest: async () => ({ categories: [], icons: [] }),
					render: { Icon: 'y#I', type: 'component' as const },
				},
			],
		}
		expect(() => registerIcon({} as Config, { adapters: [layered] })).toThrow(
			'duplicate icon layer id'
		)
	})

	// generate:importmap scans admin.dependencies, not registry strings, so a layer whose
	// render path is not registered here loses its glyphs on the next regeneration.
	it('registers each layer render path as an importMap dependency', () => {
		const config = {} as Config
		const layered = {
			...lucideAdapter(),
			layers: [
				{
					id: 'nodes',
					loadManifest: async () => ({ categories: [], icons: [] }),
					render: { load: 'a#loadNodes', type: 'nodes' as const },
				},
				{
					id: 'urls',
					loadManifest: async () => ({ categories: [], icons: [] }),
					render: { resolve: 'b#resolveUrl', type: 'url' as const },
				},
				{
					id: 'comp',
					loadManifest: async () => ({ categories: [], icons: [] }),
					render: { Icon: 'c#Icon', type: 'component' as const },
				},
			],
		}
		registerIcon(config, { adapters: [layered] })
		const deps = config.admin?.dependencies ?? {}
		expect(deps['fields-icon-lucide-nodes']).toEqual({ path: 'a#loadNodes', type: 'function' })
		expect(deps['fields-icon-lucide-urls']).toEqual({ path: 'b#resolveUrl', type: 'function' })
		expect(deps['fields-icon-lucide-comp']).toEqual({ path: 'c#Icon', type: 'component' })
	})

	// Every adapter written before layers existed has none, and must register exactly the
	// three entries it always did.
	it('registers nothing extra for a layerless adapter', () => {
		const config = {} as Config
		registerIcon(config, { adapters: [lucideAdapter()] })
		expect(Object.keys(config.admin?.dependencies ?? {}).sort()).toEqual([
			'fields-icon-lucide-Assets',
			'fields-icon-lucide-Icon',
			'fields-icon-lucide-Nodes',
		])
	})
})
