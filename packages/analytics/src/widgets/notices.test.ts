import { describe, expect, it } from 'vitest'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import { NOTICE_SEPARATOR, noticeTexts, timeAgo, widgetNotice } from './notices'

const t: Translate = (key, vars) => (vars ? `t(${key} ${JSON.stringify(vars)})` : `t(${key})`)
const NOW = new Date('2026-10-07T12:00:00.000Z')
const context = { t, locale: 'en', now: NOW }
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()

describe('widgetNotice', () => {
	it('says nothing for a read that carries no caveat', () => {
		expect(widgetNotice({}, context)).toBe('')
	})

	it('joins every caveat onto one line, widest-reaching first', () => {
		expect(
			widgetNotice({ sampled: true, clamped: true, stale: true, filtersUnapplied: true }, context)
		).toBe(
			[keys.viewStale, keys.stateClamped, keys.stateFiltersUnapplied, keys.stateSampled]
				.map((key) => `t(${key})`)
				.join(NOTICE_SEPARATOR)
		)
	})

	it('says a stale read needs its source checked, naming a refused host', () => {
		expect(widgetNotice({ stale: true, sourceError: true }, context)).toBe(
			[keys.viewStale, keys.viewErrorMisconfigured].map((key) => `t(${key})`).join(NOTICE_SEPARATOR)
		)
		expect(widgetNotice({ stale: true, sourceError: true, hostRefused: true }, context)).toBe(
			[keys.viewStale, keys.viewErrorHostRefused].map((key) => `t(${key})`).join(NOTICE_SEPARATOR)
		)
	})

	it('leads with a substituted source, worded without naming the source it replaced', () => {
		const line = widgetNotice({ substitutedFrom: 'posthog:65f0c2a9e1', stale: true }, context)
		expect(line).toBe(
			[keys.stateSourceSubstituted, keys.viewStale].map((key) => `t(${key})`).join(NOTICE_SEPARATOR)
		)
		expect(line).not.toContain('posthog')
	})

	it('prefers the unresolved-goals notice over the no-goals one', () => {
		expect(widgetNotice({ goalsUnresolved: true, noGoals: true }, context)).toBe(
			`t(${keys.stateGoalsUnresolved})`
		)
		expect(widgetNotice({ noGoals: true }, context)).toBe(`t(${keys.stateNoGoals})`)
	})
})

describe('noticeTexts', () => {
	it('puts a zone it could not find, uncounted days and grouped values before the rest', () => {
		expect(
			noticeTexts(
				{ clamped: true, capped: true, partial: true, timezoneUnresolved: true, stale: true },
				context
			)
		).toEqual(
			[
				keys.viewStale,
				keys.stateTimezoneUnresolved,
				keys.statePartial,
				keys.stateCapped,
				keys.stateClamped,
			].map((key) => `t(${key})`)
		)
	})

	it('says days whose counting was given up are missing or older', () => {
		expect(noticeTexts({ failed: true, partial: true }, context)).toEqual([
			`t(${keys.statePartial})`,
			`t(${keys.stateFailed})`,
		])
	})

	it('names the days a clamped read kept, at either end, in the reporting zone', () => {
		const berlin = { ...context, timeZone: 'Europe/Berlin' }
		expect(noticeTexts({ clamped: true, dataFrom: '2026-07-11T22:00:00.000Z' }, berlin)).toEqual([
			`t(${keys.stateClampedFrom} {"date":"Jul 12, 2026"})`,
		])
		expect(noticeTexts({ clamped: true, dataTo: '2026-10-08T21:59:59.999Z' }, berlin)).toEqual([
			`t(${keys.stateClampedTo} {"date":"Oct 8, 2026"})`,
		])
		expect(
			noticeTexts(
				{
					clamped: true,
					dataFrom: '2026-07-11T22:00:00.000Z',
					dataTo: '2026-10-08T21:59:59.999Z',
				},
				berlin
			)
		).toEqual([`t(${keys.stateClampedBetween} {"from":"Jul 12, 2026","to":"Oct 8, 2026"})`])
	})

	it('names mixed currencies only when there are several', () => {
		expect(noticeTexts({ mixedCurrencies: ['EUR'] }, context)).toEqual([])
		expect(noticeTexts({ mixedCurrencies: ['EUR', 'USD'] }, context)).toEqual([
			`t(${keys.stateMixedCurrencies} ${JSON.stringify({ currencies: 'EUR and USD' })})`,
		])
	})

	// A list in the reader's language: its own "and" and its own commas.
	it('lists the currencies as the language lists things', () => {
		expect(
			noticeTexts({ mixedCurrencies: ['CHF', 'EUR', 'USD'] }, { ...context, locale: 'de' })
		).toEqual([
			`t(${keys.stateMixedCurrencies} ${JSON.stringify({ currencies: 'CHF, EUR und USD' })})`,
		])
	})

	// The metric's own name, "Visitors, counted per day", says it; no note repeats it.
	it('adds no note for visitors counted per day', () => {
		expect(noticeTexts({ visitorsSummed: true }, context)).toEqual([])
	})

	it('says PostHog drops visits counted without consent right after a source failure', () => {
		expect(
			noticeTexts({ withoutConsentDropped: true, sourceError: true, sampled: true }, context)
		).toEqual([
			`t(${keys.viewErrorMisconfigured})`,
			`t(${keys.statePosthogCookielessDropped})`,
			`t(${keys.stateSampled})`,
		])
	})

	it('says how many pageviews were recorded without a visitor, as the language writes numbers', () => {
		expect(noticeTexts({ withoutVisitor: 1204 }, context)).toEqual([
			`t(${keys.stateWithoutVisitor} ${JSON.stringify({ count: '1,204' })})`,
		])
		expect(noticeTexts({ withoutVisitor: 1204 }, { ...context, locale: 'de' })).toEqual([
			`t(${keys.stateWithoutVisitor} ${JSON.stringify({ count: '1.204' })})`,
		])
	})

	it('says last how long ago a snapshot brought the numbers up to date', () => {
		expect(noticeTexts({ partial: true, asOf: ago(3 * 60_000) }, context)).toEqual([
			`t(${keys.statePartial})`,
			`t(${keys.stateUpdated} ${JSON.stringify({ ago: '3 minutes ago' })})`,
		])
	})
})

describe('timeAgo', () => {
	it('words seconds, minutes and hours in the reader’s language', () => {
		expect(timeAgo(ago(0), NOW, 'en')).toBe('now')
		expect(timeAgo(ago(40_000), NOW, 'en')).toBe('40 seconds ago')
		expect(timeAgo(ago(60_000), NOW, 'en')).toBe('1 minute ago')
		expect(timeAgo(ago(125 * 60_000), NOW, 'en')).toBe('2 hours ago')
		expect(timeAgo(ago(3 * 60_000), NOW, 'de')).toBe('vor 3 Minuten')
	})

	it('reads an instant after now as now, and an unknown language as English', () => {
		expect(timeAgo(new Date(NOW.getTime() + 5000).toISOString(), NOW, 'en')).toBe('now')
		expect(timeAgo(ago(3 * 60_000), NOW, 'not a locale!')).toBe('3 minutes ago')
	})
})
