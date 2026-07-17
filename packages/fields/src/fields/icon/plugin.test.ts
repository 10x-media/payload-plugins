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
})
