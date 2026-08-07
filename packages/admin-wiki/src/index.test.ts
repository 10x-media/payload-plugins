import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { adminWiki } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('adminWiki factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof adminWiki({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(adminWiki({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = adminWiki({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.adminWiki?.pluginName).toBe('Beispiel')
		expect(i18n.en?.adminWiki?.pluginName).toBe('Admin Wiki')
	})
})
