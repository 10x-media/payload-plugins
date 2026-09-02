import { describe, expect, it } from 'vitest'

import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { id } from './id'
import { translations } from './index'
import { keys } from './keys'
import { pt } from './pt'
import { ru } from './ru'
import { uk } from './uk'
import { zh } from './zh'

const locales = { ar, de, en, es, fr, id, pt, ru, uk, zh }

describe('translations', () => {
	it('nests every flat key under the webhooks namespace', () => {
		const nested = translations.en.webhooks
		expect(nested, 'webhooks namespace missing from translations').toBeDefined()
		if (!nested) return
		for (const fullKey of Object.values(keys)) {
			const short = fullKey.slice('webhooks:'.length)
			expect(nested[short], `missing en value for ${fullKey}`).toBeTypeOf('string')
		}
	})

	it.each(Object.entries(locales))('%s covers exactly the English key set', (_name, locale) => {
		expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort())
	})

	it.each(Object.entries(locales))('%s has no blank strings', (_name, locale) => {
		for (const [key, value] of Object.entries(locale)) {
			expect(value.trim(), `blank value for ${key}`).not.toBe('')
		}
	})

	it('ships every locale nested under the plugin namespace', () => {
		for (const name of Object.keys(locales)) {
			expect(translations[name as keyof typeof translations], name).toHaveProperty('webhooks')
		}
	})
})
