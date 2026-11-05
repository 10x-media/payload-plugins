import { describe, expect, it } from 'vitest'
import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { id } from './id'
import { translations } from './index'
import { type PluralCategory, type PluralName, pluralKeys } from './keys'
import { ko } from './ko'
import { plural, pluralCategory, pluralKey, pluralParts } from './plural'
import { pt } from './pt'
import { ru } from './ru'
import type { Translate } from './server'
import { uk } from './uk'
import { zh } from './zh'

const BUNDLES: Record<string, Record<string, string>> = {
	ar,
	de,
	en,
	es,
	fr,
	id,
	ko,
	pt,
	ru,
	uk,
	zh,
}

const NAMES = Object.keys(pluralKeys) as PluralName[]

const CATEGORIES: PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other']

/** Payload's `t` over one flat bundle: the key's string, `{{vars}}` filled in one pass. */
const tOf =
	(bundle: Record<string, string>): Translate =>
	(key, vars) =>
		(bundle[key] ?? key).replace(/\{\{(.*?)\}\}/g, (match, name: string) => {
			const value = vars?.[name.trim()]
			return value === undefined ? match : String(value)
		})

const i18nOf = (language: string, strings: unknown = Reflect.get(translations, language)) => ({
	language,
	translations: strings,
})

describe('plural forms in the shipped bundles', () => {
	it.each(Object.keys(BUNDLES))('%s defines exactly the forms its language has', (locale) => {
		const bundle = BUNDLES[locale] ?? {}
		const expected = [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories].sort()
		for (const name of NAMES) {
			const defined = CATEGORIES.filter((category) => pluralKeys[name][category] in bundle).sort()
			expect(defined, `${locale} ${name}`).toEqual(expected)
		}
	})

	it.each(Object.keys(BUNDLES))('%s writes the count into every form', (locale) => {
		const bundle = BUNDLES[locale] ?? {}
		for (const name of NAMES) {
			for (const category of CATEGORIES) {
				const value = bundle[pluralKeys[name][category]]
				if (value !== undefined) {
					expect(value, `${locale} ${name} ${category}`).toContain('{{count}}')
				}
			}
		}
	})
})

describe('pluralKey', () => {
	it('follows the language rules where Payload counts by thresholds', () => {
		const i18n = i18nOf('ru')
		expect(pluralKey(i18n, 'liveVisitors', 1)).toBe(pluralKeys.liveVisitors.one)
		expect(pluralKey(i18n, 'liveVisitors', 3)).toBe(pluralKeys.liveVisitors.few)
		// Payload's own `t({ count })` sends anything above five to `_many`: 22 and 101 are not.
		expect(pluralKey(i18n, 'liveVisitors', 22)).toBe(pluralKeys.liveVisitors.few)
		expect(pluralKey(i18n, 'liveVisitors', 101)).toBe(pluralKeys.liveVisitors.one)
		expect(pluralKey(i18n, 'liveVisitors', 11)).toBe(pluralKeys.liveVisitors.many)
	})

	it('reads Arabic in all six forms', () => {
		const i18n = i18nOf('ar')
		const forms = [0, 1, 2, 3, 11, 100].map((n) => pluralKey(i18n, 'livePageviews', n))
		expect(forms).toEqual([
			pluralKeys.livePageviews.zero,
			pluralKeys.livePageviews.one,
			pluralKeys.livePageviews.two,
			pluralKeys.livePageviews.few,
			pluralKeys.livePageviews.many,
			pluralKeys.livePageviews.other,
		])
	})

	it('falls back to the other form where a language lacks the one asked for', () => {
		// A Polish admin the install translated with one form only.
		const strings = { analytics: { liveVisitors_other: '{{count}} odwiedzających' } }
		expect(pluralKey(i18nOf('pl', strings), 'liveVisitors', 3)).toBe(pluralKeys.liveVisitors.other)
	})

	// `zhTw` is Payload's Traditional Chinese, which has one form for every count.
	it('reads a Payload code Intl refuses in its language, and anything else as English', () => {
		expect(pluralCategory('zhTw', 1)).toBe('other')
		expect(pluralCategory('rs', 2)).toBe(pluralCategory('sr-Cyrl', 2))
		expect(pluralCategory('not a tag', 1)).toBe('one')
	})
})

describe('plural', () => {
	it('fills the count as the language writes it', () => {
		expect(plural({ t: tOf(en), i18n: i18nOf('en') }, 'liveVisitors', 1234)).toBe(
			'1,234 visitors active right now'
		)
		expect(plural({ t: tOf(en), i18n: i18nOf('en') }, 'liveVisitors', 1)).toBe(
			'1 visitor active right now'
		)
		expect(plural({ t: tOf(ru), i18n: i18nOf('ru') }, 'liveVisitors', 5)).toBe(
			'5 посетителей сейчас на сайте'
		)
	})

	it('cuts a phrase at its count, wherever the language puts it', () => {
		expect(pluralParts({ t: tOf(en), i18n: i18nOf('en') }, 'liveVisitors', 3)).toEqual({
			before: '',
			count: '3',
			after: ' visitors active right now',
		})
		expect(pluralParts({ t: tOf(ko), i18n: i18nOf('ko') }, 'liveVisitors', 3)).toEqual({
			before: '현재 활성 방문자 ',
			count: '3',
			after: '명',
		})
	})

	it('keeps a host string that leaves the count out after the number', () => {
		const t: Translate = () => 'live'
		expect(pluralParts({ t, i18n: i18nOf('en') }, 'liveVisitors', 3)).toEqual({
			before: '',
			count: '3',
			after: 'live',
		})
	})
})
