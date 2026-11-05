import { dateTimeFormat, listFormat, numberFormat, relativeTimeFormat } from '../translations/intl'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import type { SubstitutedSource } from './prepareWidgetRead'
import type { ReadNotices } from './readMeta'

/** What a read can carry beyond its numbers, each of which earns a word of caveat. */
export type WidgetNoticeFlags = Partial<ReadNotices> &
	SubstitutedSource & {
		/** The read asked about goals and the scope declared none of its own. */
		noGoals?: boolean
	}

/** What wording a notice needs beyond its key: the reader's language and the moment it is read. */
export interface NoticeContext {
	t: Translate
	locale: string
	now: Date
	/** The reporting timezone a clamped window's days are named in; UTC when absent. */
	timeZone?: string
}

/** Between notices on the one line: a list separator, not sentence punctuation. */
export const NOTICE_SEPARATOR = ' · '

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const relativeFormat = (locale: string): Intl.RelativeTimeFormat =>
	relativeTimeFormat(locale, { numeric: 'auto' })

/** How long ago `asOf` was, in the reader's language: "3 minutes ago". */
export const timeAgo = (asOf: string, now: Date, locale: string): string => {
	const elapsed = Math.max(0, now.getTime() - Date.parse(asOf))
	const format = relativeFormat(locale)
	if (elapsed < MINUTE) {
		return format.format(-Math.round(elapsed / SECOND), 'second')
	}
	if (elapsed < HOUR) {
		return format.format(-Math.floor(elapsed / MINUTE), 'minute')
	}
	return format.format(-Math.floor(elapsed / HOUR), 'hour')
}

/** The day an instant falls on in the reader's language and the reporting zone: "Mar 3, 2026". */
const dayOf = (instant: string, context: NoticeContext): string =>
	dateTimeFormat(context.locale, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: context.timeZone ?? 'UTC',
	}).format(new Date(instant))

/** What a clamped read covers, by the bounds it kept, else the generic wording. */
const clampedText = (flags: WidgetNoticeFlags, context: NoticeContext): string => {
	const { t } = context
	const from = flags.dataFrom
	const to = flags.dataTo
	if (from && to) {
		return t(keys.stateClampedBetween, { from: dayOf(from, context), to: dayOf(to, context) })
	}
	if (from) return t(keys.stateClampedFrom, { date: dayOf(from, context) })
	if (to) return t(keys.stateClampedTo, { date: dayOf(to, context) })
	return t(keys.stateClamped)
}

/**
 * The caveats a read carries, each a sentence, widest-reaching first, so the one that changes what
 * the number means the most is read first. Empty when the read carries none, the common case.
 */
export const noticeTexts = (flags: WidgetNoticeFlags, context: NoticeContext): string[] => {
	const { t } = context
	const texts: string[] = []
	// The id is not named: it can be an internal one, such as a provider document's.
	if (flags.substitutedFrom !== undefined) texts.push(t(keys.stateSourceSubstituted))
	if (flags.stale) texts.push(t(keys.viewStale))
	if (flags.hostRefused) texts.push(t(keys.viewErrorHostRefused))
	else if (flags.sourceError) texts.push(t(keys.viewErrorMisconfigured))
	if (flags.withoutConsentDropped) texts.push(t(keys.statePosthogCookielessDropped))
	if (flags.timezoneUnresolved) texts.push(t(keys.stateTimezoneUnresolved))
	if (flags.partial) texts.push(t(keys.statePartial))
	if (flags.capped) texts.push(t(keys.stateCapped))
	if (flags.failed) texts.push(t(keys.stateFailed))
	if (flags.clamped) texts.push(clampedText(flags, context))
	if (flags.filtersUnapplied) texts.push(t(keys.stateFiltersUnapplied))
	if (flags.sampled) texts.push(t(keys.stateSampled))
	if (flags.withoutVisitor) {
		const count = numberFormat(context.locale).format(flags.withoutVisitor)
		texts.push(t(keys.stateWithoutVisitor, { count }))
	}
	const currencies = flags.mixedCurrencies ?? []
	if (currencies.length > 1) {
		const named = listFormat(context.locale, { type: 'conjunction' }).format(currencies)
		texts.push(t(keys.stateMixedCurrencies, { currencies: named }))
	}
	// A conversions number with no goals behind it is a number about nothing, which the plain
	// caption would read as "nobody converted".
	if (flags.goalsUnresolved) texts.push(t(keys.stateGoalsUnresolved))
	else if (flags.noGoals) texts.push(t(keys.stateNoGoals))
	if (flags.asOf) {
		texts.push(t(keys.stateUpdated, { ago: timeAgo(flags.asOf, context.now, context.locale) }))
	}
	return texts
}

/**
 * The caveats as one line: a card is a few centimetres tall, and notices stacked under it would
 * push the number itself out of view.
 */
export const widgetNotice = (flags: WidgetNoticeFlags, context: NoticeContext): string =>
	noticeTexts(flags, context).join(NOTICE_SEPARATOR)
