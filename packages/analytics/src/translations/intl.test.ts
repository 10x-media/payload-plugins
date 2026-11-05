import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bucketLabel, bucketTooltipLabel } from '../charts/bucket'
import type { Granularity, MetricKey } from '../core/contract'
import { formatCurrency, formatDuration, formatMetricValue, formatRate } from '../fields/format'
import { currencyOptions } from '../goals/currencyOptions'
import { valueLabel } from '../view/labels'
import { timeAgo } from '../widgets/notices'
import { formatRangeCaption } from '../widgets/range'
import { toRealtimePoints } from '../widgets/realtimePoll'
import { intlLocale, numberFormat } from './intl'
import { plural, pluralCategory } from './plural'

/**
 * Payload's language codes, from installed `@payloadcms/translations` (resolved via `payload`):
 * `acceptedLanguages` (`zh-TW`) plus module names hosts import (`zhTw`).
 */
const payloadLanguageCodes = async (): Promise<string[]> => {
	const fromHere = createRequire(import.meta.url)
	const fromPayload = createRequire(fromHere.resolve('payload'))
	const entry = fromPayload.resolve('@payloadcms/translations')
	const translations: { acceptedLanguages: readonly string[] } = await import(entry)
	const modules = readdirSync(join(dirname(entry), '..', 'languages'))
		.filter((file) => file.endsWith('.js'))
		.map((file) => file.slice(0, -'.js'.length))
	return [...new Set([...translations.acceptedLanguages, ...modules])].sort()
}

const METRICS: MetricKey[] = [
	'pageviews',
	'visitors',
	'bounceRate',
	'avgDuration',
	'visitDuration',
	'scrollDepth',
	'revenue',
	'impressions',
]

const GRANULARITIES: Granularity[] = ['minute', 'hour', 'day', 'week', 'month']

const AT = new Date('2026-10-08T13:45:00.000Z')

describe('intlLocale', () => {
	it("maps Payload's codes Intl refuses or misreads to the language they name", () => {
		expect(intlLocale('zhTw')).toBe('zh-TW')
		expect(intlLocale('zh-TW')).toBe('zh-TW')
		expect(intlLocale('bnBd')).toBe('bn-BD')
		expect(intlLocale('bnIn')).toBe('bn-IN')
		expect(intlLocale('bn-BD')).toBe('bn-BD')
		expect(intlLocale('rs')).toBe('sr-Cyrl')
		expect(intlLocale('rsLatin')).toBe('sr-Latn')
		expect(intlLocale('rs-latin')).toBe('sr-Latn')
	})

	it('keeps a code Intl reads, and falls back to English for one it cannot', () => {
		expect(intlLocale('de')).toBe('de')
		expect(intlLocale('pt')).toBe('pt')
		expect(intlLocale('xx')).toBe('en')
		expect(intlLocale('not a tag')).toBe('en')
		expect(intlLocale('')).toBe('en')
		expect(intlLocale(undefined)).toBe('en')
	})

	// Serbian groups thousands with a dot; the en-US fallback the bare code fell to does not.
	it('formats Serbian as Serbian rather than as American English', () => {
		expect(numberFormat('rs').format(1234.5)).toBe(numberFormat('sr-Cyrl').format(1234.5))
		expect(numberFormat('rs').format(1234.5)).not.toBe('1,234.5')
	})
})

describe('every Payload language code', async () => {
	const codes = await payloadLanguageCodes()

	it('reads the list from Payload itself, both spellings included', () => {
		expect(codes).toEqual(expect.arrayContaining(['en', 'zh-TW', 'zhTw', 'bnBd', 'rsLatin']))
	})

	it.each(codes)('renders every formatting helper in %s without throwing', (code) => {
		const locale = intlLocale(code)
		expect(Intl.NumberFormat.supportedLocalesOf([locale])).toEqual([locale])
		for (const language of [code, locale]) {
			for (const metric of METRICS) {
				expect(formatMetricValue(metric, 1234.5, { locale: language, currency: 'EUR' })).not.toBe(
					''
				)
			}
			expect(formatRate(0.0483, language)).not.toBe('')
			expect(formatRate(0.0004, language)).not.toBe('')
			expect(formatDuration(3_725_000, language)).not.toBe('')
			expect(formatCurrency(10, language, 'NOPE')).not.toBe('')
			for (const granularity of GRANULARITIES) {
				expect(bucketLabel(AT, { granularity, locale: language, tz: 'Europe/Berlin' })).not.toBe('')
			}
			expect(
				bucketTooltipLabel(AT, { granularity: 'hour', locale: language, tz: 'Asia/Kolkata' })
			).not.toBe('')
			expect(formatRangeCaption({ start: AT, end: AT }, language, 'America/New_York')).not.toBe('')
			expect(pluralCategory(language, 3)).not.toBe('')
			expect(
				plural(
					{ t: (_key, vars) => String(vars?.count), i18n: { language, translations: {} } },
					'liveVisitors',
					12_345
				)
			).not.toBe('')
			expect(timeAgo('2026-10-08T13:40:00.000Z', AT, language)).not.toBe('')
			expect(
				toRealtimePoints([{ date: AT.toISOString(), value: 3 }], language, 'UTC')
			).toHaveLength(1)
			expect(currencyOptions(language).length).toBeGreaterThan(0)
			const t = (key: string): string => key
			expect(
				valueLabel({ dimension: 'country', value: 'DE', provider: 'native', t, locale: language })
			).not.toBe('')
			expect(
				valueLabel({
					dimension: 'language',
					value: 'de-de',
					provider: 'native',
					t,
					locale: language,
				})
			).not.toBe('')
		}
	})
})
