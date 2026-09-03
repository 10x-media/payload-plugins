import { describe, expect, it } from 'vitest'

import { de } from './de'
import { en } from './en'
import { translations } from './index'
import { keys } from './keys'
import { pt } from './pt'

const locales = { de, en, pt }

describe('translation keys', () => {
	it('every declared key has an English string', () => {
		for (const key of Object.values(keys)) {
			expect(en[key as keyof typeof en], `missing en value for ${key}`).toBeTruthy()
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

	it.each(Object.entries(locales))('%s keeps every placeholder English uses', (_name, locale) => {
		for (const [key, value] of Object.entries(en)) {
			const placeholders = value.match(/{{\w+}}/g) ?? []
			for (const placeholder of placeholders) {
				expect(locale[key as keyof typeof locale], `${key} lost ${placeholder}`).toContain(
					placeholder
				)
			}
		}
	})

	it('keys are namespaced so Payload can resolve them', () => {
		for (const key of Object.values(keys)) {
			expect(key.startsWith('adminWiki:')).toBe(true)
		}
	})
})

describe('translations', () => {
	it('exposes every locale nested under the plugin namespace', () => {
		for (const locale of Object.keys(locales)) {
			expect(translations[locale as keyof typeof translations]).toHaveProperty('adminWiki')
		}
	})
})
