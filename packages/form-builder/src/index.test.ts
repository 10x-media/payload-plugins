import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { formBuilder } from './index'

describe('formBuilder factory', () => {
	it('is a definePlugin plugin carrying the package slug', () => {
		const plugin = formBuilder({})
		expect(typeof plugin).toBe('function')
		expect(plugin.slug).toBe('@10x-media/form-builder')
	})

	it('returns the config untouched when disabled', async () => {
		const plugin = formBuilder({ disabled: true })
		const config = { collections: [{ slug: 'users', fields: [] }] } as unknown as Config
		const result = await Promise.resolve(plugin(config))
		expect(result.collections).toHaveLength(1)
	})
})
