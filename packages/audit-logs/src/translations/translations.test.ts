import { describe, expect, it } from 'vitest'

import { de } from './de'
import { en } from './en'
import { toNested, translations } from './index'
import { keys } from './keys'
import { uk } from './uk'

const locales = { de, en, uk }

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
			expect(key.startsWith('auditLogs:')).toBe(true)
		}
	})
})

describe('toNested', () => {
	it('splits a flat key on the namespace separator', () => {
		expect(toNested({ 'auditLogs:title': 'Audit logs' })).toEqual({
			auditLogs: { title: 'Audit logs' },
		})
	})

	it('collects several keys into one namespace', () => {
		expect(toNested({ 'auditLogs:a': 'A', 'auditLogs:b': 'B' })).toEqual({
			auditLogs: { a: 'A', b: 'B' },
		})
	})

	it('skips undefined values so partial override maps pass through', () => {
		expect(toNested({ 'auditLogs:a': 'A', 'auditLogs:b': undefined })).toEqual({
			auditLogs: { a: 'A' },
		})
	})
})

describe('translations', () => {
	it('exposes every locale nested under the plugin namespace', () => {
		for (const locale of Object.keys(locales)) {
			expect(translations[locale as keyof typeof translations]).toHaveProperty('auditLogs')
		}
	})
})
