import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { automations } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('automations factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof automations({})).toBe('function')
	})

	it('applies the translations option', () => {
		const out = automations({ translations: { de: { [keys.pluginName]: 'Automationen' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.automations?.pluginName).toBe('Automationen')
		expect(i18n.en?.automations?.pluginName).toBe('Automations')
	})
})
