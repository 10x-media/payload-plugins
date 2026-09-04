import { describe, expect, it } from 'vitest'

import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { id } from './id'
import { toNested, translations } from './index'
import { keys } from './keys'
import { ko } from './ko'
import { pt } from './pt'
import { ru } from './ru'
import { uk } from './uk'
import { zh } from './zh'

const locales = { ar, de, en, es, fr, id, ko, pt, ru, uk, zh }

const contractKeys = [
	'fields:presets',
	'fields:searchIcons',
	'fields:noIconsFound',
	'fields:browseAll',
	'fields:recent',
	'fields:allIcons',
	'fields:libraryUnavailable',
	'fields:missingPreset',
	'fields:reveal',
	'fields:conceal',
	'fields:encryptedValue',
] as const

describe('translations', () => {
	it('defines every cross-phase contract key', () => {
		const defined = new Set<string>(Object.values(keys))
		for (const key of contractKeys) {
			expect(defined.has(key), `missing contract key ${key}`).toBe(true)
		}
	})

	it('namespaces every key under fields:', () => {
		for (const key of Object.values(keys)) {
			expect(key.startsWith('fields:'), key).toBe(true)
		}
	})

	it.each(Object.entries(locales))('%s covers every key', (name, locale) => {
		for (const key of Object.values(keys)) {
			expect(locale[key], `${name} missing ${key}`).toBeTypeOf('string')
		}
	})

	it('ships every locale nested to Payload', () => {
		expect(translations.en.fields?.presets).toBe('Presets')
		expect(translations.de.fields?.presets).toBe('Voreinstellungen')
		for (const name of Object.keys(locales)) {
			expect(translations[name as keyof typeof translations], name).toHaveProperty('fields')
		}
	})

	it('nests flat keys on the first colon', () => {
		expect(toNested({ 'fields:presets': 'Presets' })).toEqual({
			fields: { presets: 'Presets' },
		})
	})
})
