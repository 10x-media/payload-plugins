import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { registerTranslations } from '../plugin/registerTranslations'
import { keys } from './keys'
import { messageFor } from './lookup'

const configWith = (
	hostTranslations?: NonNullable<Config['i18n']>['translations'],
	overrides?: Parameters<typeof registerTranslations>[1]
) => {
	const config = { i18n: { translations: hostTranslations } } as Config
	registerTranslations(config, overrides)
	return config.i18n?.translations
}

describe('messageFor', () => {
	it('reads a host override from the merged config translations', () => {
		const translations = configWith({ en: { impersonation: { actingAs: 'Viewing as {{name}}' } } })
		expect(messageFor('en', keys.actingAs, translations)).toBe('Viewing as {{name}}')
	})

	it('reads an override passed through the translations option', () => {
		const translations = configWith(undefined, { de: { [keys.actingAs]: 'Ansicht als {{name}}' } })
		expect(messageFor('de', keys.actingAs, translations)).toBe('Ansicht als {{name}}')
	})

	it("keeps the impersonator's locale when the host overrides English only", () => {
		const translations = configWith({ en: { impersonation: { actingAs: 'Viewing as {{name}}' } } })
		expect(messageFor('de-AT', keys.actingAs, translations)).toBe('Handelt als {{name}}')
	})

	it('falls back to English, then to the key', () => {
		expect(messageFor('xx', keys.actingAs)).toBe('Acting as {{name}}')
		expect(messageFor(null, keys.actingAs, {})).toBe('Acting as {{name}}')
		expect(messageFor('en', 'impersonation:missing' as typeof keys.actingAs)).toBe(
			'impersonation:missing'
		)
	})
})
