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

	it('keys are namespaced so Payload can resolve them', () => {
		for (const key of Object.values(keys)) {
			expect(key.startsWith('documentPreview:')).toBe(true)
		}
	})
})

describe('toNested', () => {
	it('splits a flat key on the namespace separator', () => {
		expect(toNested({ 'documentPreview:title': 'Document Preview' })).toEqual({
			documentPreview: { title: 'Document Preview' },
		})
	})

	it('collects several keys into one namespace', () => {
		expect(toNested({ 'documentPreview:a': 'A', 'documentPreview:b': 'B' })).toEqual({
			documentPreview: { a: 'A', b: 'B' },
		})
	})

	it('skips undefined values so partial override maps pass through', () => {
		expect(toNested({ 'documentPreview:a': 'A', 'documentPreview:b': undefined })).toEqual({
			documentPreview: { a: 'A' },
		})
	})
})

describe('translations', () => {
	it('exposes every locale nested under the plugin namespace', () => {
		for (const locale of Object.keys(locales)) {
			expect(translations[locale as keyof typeof translations]).toHaveProperty('documentPreview')
		}
	})
})

describe('placeholders', () => {
	const names = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

	it.each(Object.entries(locales))('%s keeps every {{placeholder}} of English', (_name, locale) => {
		for (const [key, value] of Object.entries(en)) {
			expect(names(locale[key as keyof typeof locale]), `placeholders of ${key}`).toEqual(
				names(value)
			)
		}
	})
})
