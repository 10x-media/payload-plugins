import { describe, expect, it } from 'vitest'
import { translations } from './index'
import { keys } from './keys'

describe('translations', () => {
	it('nests every flat key under the webhooks namespace', () => {
		const en = translations.en.webhooks
		expect(en, 'webhooks namespace missing from translations').toBeDefined()
		if (!en) return
		for (const fullKey of Object.values(keys)) {
			const short = fullKey.slice('webhooks:'.length)
			expect(en[short], `missing en value for ${fullKey}`).toBeTypeOf('string')
		}
	})
})
