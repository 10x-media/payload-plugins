import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { wildix } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('wildix factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof wildix({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(wildix({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = wildix({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.wildix?.pluginName).toBe('Beispiel')
		expect(i18n.en?.wildix?.pluginName).toBe('Wildix')
	})
})
