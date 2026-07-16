import { describe, expect, it } from 'vitest'

import { de } from './de'
import { en } from './en'
import { toNested, translations } from './index'
import { keys } from './keys'

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

	it('covers every key in every shipped locale', () => {
		for (const key of Object.values(keys)) {
			expect(en[key], `en missing ${key}`).toBeTypeOf('string')
			expect(de[key], `de missing ${key}`).toBeTypeOf('string')
		}
	})

	it('ships nested en and de to Payload', () => {
		expect(translations.en.fields?.presets).toBe('Presets')
		expect(translations.de.fields?.presets).toBe('Voreinstellungen')
	})

	it('nests flat keys on the first colon', () => {
		expect(toNested({ 'fields:presets': 'Presets' })).toEqual({
			fields: { presets: 'Presets' },
		})
	})
})
