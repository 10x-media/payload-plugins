import { describe, expect, it } from 'vitest'

import { de } from './de'
import { en } from './en'
import { translations } from './index'
import { keys } from './keys'

const locales = { de, en }

describe('translations', () => {
	it('nests every flat key under the feedbackRecorder namespace', () => {
		const nested = translations.en.feedbackRecorder
		for (const fullKey of Object.values(keys)) {
			const short = fullKey.slice('feedbackRecorder:'.length)
			expect(nested?.[short], `missing en value for ${fullKey}`).toBeTypeOf('string')
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
})
