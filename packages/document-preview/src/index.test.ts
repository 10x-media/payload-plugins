import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { documentPreview } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('documentPreview factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof documentPreview({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(documentPreview({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = documentPreview({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.documentPreview?.pluginName).toBe('Beispiel')
		expect(i18n.en?.documentPreview?.pluginName).toBe('Document Preview')
	})
})
