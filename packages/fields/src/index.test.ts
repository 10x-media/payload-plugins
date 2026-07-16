import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { fields } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('fields factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof fields({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(fields({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = fields({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.fields?.pluginName).toBe('Beispiel')
		expect(i18n.en?.fields?.pluginName).toBe('Fields')
	})
})
