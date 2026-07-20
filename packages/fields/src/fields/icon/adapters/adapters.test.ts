import { describe, expect, it } from 'vitest'
import { lucideAdapter } from './lucide/adapter'
import { radixAdapter } from './radix/adapter'
import { tablerAdapter } from './tabler/adapter'

const pascal = (slug: string): string => `${slug.charAt(0).toUpperCase()}${slug.slice(1)}`

describe('first-party adapters', () => {
	const adapters = [lucideAdapter(), radixAdapter(), tablerAdapter()]

	it('carry the contracted shape', () => {
		for (const adapter of adapters) {
			expect(adapter.version).toBe(1)
			expect(adapter.Icon).toBe(
				`@10x-media/fields/icon/adapters/${adapter.slug}#${pascal(adapter.slug)}AdapterIcon`
			)
			expect(adapter.Assets).toBe(
				`@10x-media/fields/icon/adapters/${adapter.slug}#${pascal(adapter.slug)}AdapterAssets`
			)
		}
		expect(adapters.map((adapter) => adapter.slug)).toEqual(['lucide', 'radix', 'tabler'])
	})

	it('lazily load their committed manifests', async () => {
		for (const adapter of adapters) {
			const manifest = await adapter.loadManifest()
			expect(manifest.icons.length).toBeGreaterThan(100)
		}
	})
})
