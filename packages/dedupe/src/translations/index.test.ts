import { describe, expect, it } from 'vitest'

import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { id } from './id'
import { toNested, translations } from './index'
import { ko } from './ko'
import { pt } from './pt'
import { ru } from './ru'
import { uk } from './uk'
import { zh } from './zh'

const locales = { ar, de, en, es, fr, id, ko, pt, ru, uk, zh }

describe('toNested', () => {
	it('nests a namespaced key under its namespace', () => {
		expect(toNested({ 'dedupe:pluginName': 'Dedupe' })).toEqual({
			dedupe: { pluginName: 'Dedupe' },
		})
	})

	it('skips undefined values so partial override maps pass through', () => {
		expect(toNested({ 'dedupe:pluginName': undefined })).toEqual({})
	})
})

describe('translation keys', () => {
	it.each(Object.entries(locales))('%s covers exactly the English key set', (_name, locale) => {
		expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort())
	})

	it.each(Object.entries(locales))('%s has no blank strings', (_name, locale) => {
		for (const [key, value] of Object.entries(locale)) {
			expect(value.trim(), `blank value for ${key}`).not.toBe('')
		}
	})

	it.each(Object.entries(locales))('%s keeps every placeholder English uses', (_name, locale) => {
		for (const [key, value] of Object.entries(en)) {
			for (const placeholder of value.match(/{{\w+}}/g) ?? []) {
				expect(locale[key as keyof typeof locale], `${key} lost ${placeholder}`).toContain(
					placeholder
				)
			}
		}
	})

	it('exposes every locale nested under the plugin namespace', () => {
		for (const locale of Object.keys(locales)) {
			expect(translations[locale as keyof typeof translations]).toHaveProperty('dedupe')
		}
	})
})
