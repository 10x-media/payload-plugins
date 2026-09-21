import type { SanitizedConfig } from 'payload'
import { describe, expect, it } from 'vitest'
import { resolveSubmissionLocale } from './submissionLocale'

const localization = {
	defaultLocale: 'en',
	localeCodes: ['en', 'de', 'pt-BR'],
} as unknown as SanitizedConfig['localization']

describe('resolveSubmissionLocale', () => {
	it('keeps a configured locale on a localized host', () => {
		expect(resolveSubmissionLocale('de', localization)).toBe('de')
		expect(resolveSubmissionLocale('pt-BR', localization)).toBe('pt-BR')
	})

	it('falls back to the default locale for all, *, unknown, or missing locales', () => {
		for (const locale of ['all', '*', 'fr', '', undefined, 42]) {
			expect(resolveSubmissionLocale(locale, localization)).toBe('en')
		}
	})

	it('keeps any plain language tag without localization', () => {
		for (const locale of ['uk', 'pt-BR', 'zh_Hant', 'sr-Latn-RS']) {
			expect(resolveSubmissionLocale(locale, false)).toBe(locale)
		}
	})

	it('falls back to en for all and anything that is not a plain tag without localization', () => {
		for (const locale of ['all', '*', 'x', '<script>', 'en\r\nX', 'a'.repeat(40), '', undefined]) {
			expect(resolveSubmissionLocale(locale, false)).toBe('en')
		}
	})
})
