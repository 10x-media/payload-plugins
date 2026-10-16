import type { AnalyticsResult } from '../core/contract'
import { earlierInstant } from '../core/values'

/** The caveats a read's numbers carry, which every surface showing them words the same way. */
export interface ReadNotices {
	/** The source read a shorter window than the one that was asked for. */
	clamped: boolean
	/** ISO instant the clamped data starts at, when later than the window's start. */
	dataFrom?: string
	/** ISO instant the clamped data ends at, when earlier than the window's end. */
	dataTo?: string
	/** The engine served an expired cache entry, while refreshing or after the refresh failed. */
	stale: boolean
	/** The saved numbers' source last failed with its settings refused: they need a look. */
	sourceError: boolean
	/** That source's host is one the install does not allow. */
	hostRefused: boolean
	/** The source answered without one of the filters the read carried. */
	filtersUnapplied: boolean
	/** The source could not read the scope's goals, so the goal numbers mean nothing. */
	goalsUnresolved: boolean
	/** The source counted from a sample, so the numbers are estimates. */
	sampled: boolean
	/** Some days of the range are not counted yet, so the numbers are a floor. */
	partial: boolean
	/** A value the read asks about was grouped into `(other)` on days whose raw hits are gone. */
	capped: boolean
	/** Some days' counting was given up: they are left out or read from an earlier count. */
	failed?: boolean
	/** The days were cut in UTC because the scope's zone could not be resolved. */
	timezoneUnresolved: boolean
	/** The currencies revenue adds without converting them, when there is more than one. */
	mixedCurrencies: string[]
	/**
	 * Some visitor number adds up each day's visitors (`meta.visitorsAre: 'sumOfDaily'`), so a
	 * person who came on two days counts twice. Said by the metric's name and explained in a notice.
	 */
	visitorsSummed?: boolean
	/** The vendor drops the visits counted without consent, so they are missing from the numbers. */
	withoutConsentDropped?: boolean
	/** Pageviews recorded without a visitor, which count toward no visitor number; absent when none. */
	withoutVisitor?: number
	/** ISO instant the numbers were last brought up to date, set when a snapshot answered. */
	asOf?: string
	/** The ISO code the read's revenue is in, when the source or the install says. */
	currency?: string
}

/** The state flags every widget result carries, whatever shape its numbers take. */
export interface WidgetReadMeta extends ReadNotices {
	/** The source that answered. */
	provider: string
}

/**
 * One mapping from an adapter result's meta to the flags a surface renders, so a flag cannot go
 * missing on one widget while its neighbour shows it.
 */
export const readMeta = (result: AnalyticsResult): WidgetReadMeta => ({
	clamped: result.meta.clamped ?? false,
	...(result.meta.clamped && result.meta.dataFrom ? { dataFrom: result.meta.dataFrom } : {}),
	...(result.meta.clamped && result.meta.dataTo ? { dataTo: result.meta.dataTo } : {}),
	stale: result.meta.stale ?? false,
	sourceError: result.meta.sourceError !== undefined,
	hostRefused: result.meta.sourceError === 'host-refused',
	filtersUnapplied: (result.meta.unappliedFilters?.length ?? 0) > 0,
	goalsUnresolved: result.meta.goalsUnresolved === true,
	sampled: result.meta.sampled ?? false,
	partial: (result.meta.partial?.missingDays ?? 0) > 0,
	capped: (result.meta.capped?.days ?? 0) > 0,
	failed: (result.meta.failed?.days ?? 0) > 0,
	timezoneUnresolved: result.meta.timezoneUnresolved === true,
	visitorsSummed: result.meta.visitorsAre === 'sumOfDaily',
	withoutConsentDropped: result.meta.withoutConsentDropped === true,
	...((result.meta.withoutVisitor?.pageviews ?? 0) > 0
		? { withoutVisitor: result.meta.withoutVisitor?.pageviews }
		: {}),
	mixedCurrencies:
		(result.meta.mixedCurrencies?.length ?? 0) > 1 ? [...(result.meta.mixedCurrencies ?? [])] : [],
	...(result.meta.asOf ? { asOf: result.meta.asOf } : {}),
	...(result.meta.currency ? { currency: result.meta.currency } : {}),
	provider: result.meta.provider,
})

/**
 * Several reads behind one surface as one set of caveats: any read's flag is the surface's, the
 * currencies are every read's, and the oldest snapshot says how old the numbers are.
 */
export const mergeNotices = (
	...reads: ReadonlyArray<Partial<ReadNotices> | undefined>
): ReadNotices => {
	const anyRead = (
		flag: Exclude<
			keyof ReadNotices,
			'mixedCurrencies' | 'asOf' | 'currency' | 'dataFrom' | 'dataTo' | 'withoutVisitor'
		>
	): boolean => reads.some((read) => read?.[flag] === true)
	// The narrowest window any read kept: the latest start, the earliest end.
	const dataFrom = reads.reduce<string | undefined>(
		(at, read) =>
			read?.dataFrom !== undefined &&
			(at === undefined || Date.parse(read.dataFrom) > Date.parse(at))
				? read.dataFrom
				: at,
		undefined
	)
	const dataTo = reads.reduce<string | undefined>(
		(at, read) => earlierInstant(at, read?.dataTo),
		undefined
	)
	const currencies = new Set(reads.flatMap((read) => read?.mixedCurrencies ?? []))
	const asOf = reads.reduce<string | undefined>(
		(at, read) => earlierInstant(at, read?.asOf),
		undefined
	)
	const currency = reads.find((read) => read?.currency !== undefined)?.currency
	// The reads cover one range, so the widest count is the range's; adding them would double it.
	const withoutVisitor = Math.max(0, ...reads.map((read) => read?.withoutVisitor ?? 0))
	return {
		clamped: anyRead('clamped'),
		...(dataFrom ? { dataFrom } : {}),
		...(dataTo ? { dataTo } : {}),
		stale: anyRead('stale'),
		sourceError: anyRead('sourceError'),
		hostRefused: anyRead('hostRefused'),
		filtersUnapplied: anyRead('filtersUnapplied'),
		goalsUnresolved: anyRead('goalsUnresolved'),
		sampled: anyRead('sampled'),
		partial: anyRead('partial'),
		capped: anyRead('capped'),
		failed: anyRead('failed'),
		timezoneUnresolved: anyRead('timezoneUnresolved'),
		visitorsSummed: anyRead('visitorsSummed'),
		withoutConsentDropped: anyRead('withoutConsentDropped'),
		...(withoutVisitor > 0 ? { withoutVisitor } : {}),
		mixedCurrencies: [...currencies].sort(),
		...(asOf ? { asOf } : {}),
		...(currency ? { currency } : {}),
	}
}
