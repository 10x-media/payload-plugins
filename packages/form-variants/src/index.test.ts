import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { formVariants } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('formVariants factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof formVariants({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(formVariants({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = formVariants({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.formVariants?.pluginName).toBe('Beispiel')
		expect(i18n.en?.formVariants?.pluginName).toBe('Form Variants')
	})
})
