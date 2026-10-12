import { createHash, createHmac } from 'node:crypto'
import type { CurrencyConverter } from '../../goals/currency'
import { labelledKey } from './signature'

/**
 * The longest order id ingest takes. Only its digest is stored, so the length costs nothing, and a
 * payment provider's own ids run long: a Stripe checkout session's is 66 characters.
 */
export const MAX_ORDER_ID_LENGTH = 255

/**
 * Largest amount ingest stores, in any currency: above it a value is a broken integration or a
 * probe, and one such row poisons every revenue sum it lands in for good.
 */
export const MAX_EVENT_VALUE = 1e12

/** A finite amount within {@link MAX_EVENT_VALUE} of zero, else undefined. */
export const boundedValue = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_EVENT_VALUE
		? value
		: undefined

const CONTROL_CHARACTER = /\p{Cc}/u

/**
 * No charset assumed: an order id is whatever the provider calls it. Past the cap it is refused,
 * not truncated, so two ids sharing a prefix cannot collapse into one dedupe key.
 */
export const sanitizeOrderId = (value: unknown): string | undefined => {
	if (typeof value !== 'string') {
		return undefined
	}
	const trimmed = value.trim()
	if (trimmed === '' || trimmed.length > MAX_ORDER_ID_LENGTH) {
		return undefined
	}
	return CONTROL_CHARACTER.test(trimmed) ? undefined : trimmed
}

interface MoneyArgs {
	/** Sanitized event value, already signed for a revenue call. */
	value?: number
	/** Sanitized ISO 4217 code the value is denominated in. */
	currency?: string
	reportingCurrency?: string
	convertCurrency?: CurrencyConverter
	at: Date
	/** Called at most once per process when an amount could not be converted. */
	warn?: () => void
}

export interface Money {
	/** What the `value` column stores, and therefore what revenue sums. */
	value?: number
	currency?: string
	/** The amount as sent, kept whenever it is not what `value` holds. */
	originalValue?: number
	originalCurrency?: string
}

/**
 * A conversion must be bounded and keep the money's sign: a rate table that answers a sale with a
 * refund has answered about something else.
 */
const usableConversion = (converted: unknown, from: number): number | undefined => {
	const bounded = boundedValue(converted)
	if (bounded === undefined) {
		return undefined
	}
	if ((from > 0 && bounded < 0) || (from < 0 && bounded > 0)) {
		return undefined
	}
	return bounded
}

/**
 * Without a usable conversion the completion still counts, with zero revenue and the original kept
 * for later reconciliation. An event with no currency is taken as already in the reporting one.
 */
export const reconcileMoney = async (args: MoneyArgs): Promise<Money> => {
	const { at, convertCurrency, currency, reportingCurrency, value, warn } = args
	if (!reportingCurrency) {
		return { ...(value !== undefined ? { value } : {}), ...(currency ? { currency } : {}) }
	}
	if (!currency || currency === reportingCurrency) {
		return { ...(value !== undefined ? { value } : {}), currency: reportingCurrency }
	}
	if (value === undefined) {
		return { currency: reportingCurrency, originalCurrency: currency }
	}
	let converted: number | undefined
	if (convertCurrency) {
		try {
			converted = usableConversion(
				await convertCurrency({ amount: value, from: currency, to: reportingCurrency, at }),
				value
			)
		} catch {
			converted = undefined
		}
	}
	if (converted === undefined) {
		warn?.()
	}
	// Unconverted is zero, not absent: the completion has declared its own money, so falling back
	// to the goal's fixed value would put an unrelated figure in the revenue sum.
	return {
		value: converted ?? 0,
		currency: reportingCurrency,
		originalValue: value,
		originalCurrency: currency,
	}
}

const UNCONVERTED_WARNING =
	'analytics: an event arrived in a currency other than revenue.currency and no revenue.convert hook answered for it. It counts as a conversion, but its amount is left out of revenue and kept in originalValue/originalCurrency. Logged once per process.'

let warnedUnconverted = false

/** One line per process: ingest is a public path and must not be a log amplifier. */
export const warnUnconvertedOnce = (logger?: { warn?: (msg: string) => void }): void => {
	if (warnedUnconverted) {
		return
	}
	warnedUnconverted = true
	logger?.warn?.(UNCONVERTED_WARNING)
}

/** One line per slug, up to this many slugs: the set is fed by whatever a caller sends. */
const MAX_WARNED_GOALS = 64
const warnedGoals = new Set<string>()

/**
 * An unmatched revenue goal stores the event but counts no conversion or revenue, which looks like
 * a working integration, hence the line. One per slug per process: a payment provider retries.
 */
export const warnUnmatchedRevenueGoal = (
	logger: { warn?: (msg: string) => void } | undefined,
	slug: string
): void => {
	if (warnedGoals.has(slug)) {
		return
	}
	if (warnedGoals.size >= MAX_WARNED_GOALS) {
		warnedGoals.clear()
	}
	warnedGoals.add(slug)
	logger?.warn?.(
		`analytics: a server purchase or refund recorded an event for goal "${slug}", which no configured goal matches, so it counts no conversion and no revenue. Define that goal, or drop the "goal" argument to use the built-in "purchase" goal. Logged once per slug per process.`
	)
}

/**
 * Which side recorded an idempotent event. The two never share a key: a browser can guess an
 * order id, and a guessed one must not be able to block the payment webhook's own write.
 */
export type IngestOrigin = 'wire' | 'server'

/** What a dedupe key starts with, by origin; the digest after it is the same for both. */
export const DEDUPE_KEY_PREFIX: Readonly<Record<IngestOrigin, string>> = {
	wire: 'w.',
	server: 's.',
}

/**
 * A negative amount, `-0` included (what `refund()` makes of a refund of nothing). A refund counts
 * its amount in revenue and no conversion.
 */
export const isRefund = (revenue: boolean, value: unknown): boolean => {
	const amount = boundedValue(value)
	return revenue && amount !== undefined && (amount < 0 || Object.is(amount, -0))
}

interface DedupeKeyArgs {
	origin: IngestOrigin
	/** The tenant this order belongs to, so two tenants can retry the same order id. */
	tenant?: string
	goal: string
	orderId: string
	/** A refund of an order already counted is a row of its own, never a swallowed duplicate. */
	refund?: boolean
	/**
	 * On a refund, its own id: two partial refunds of one order are two rows, and a retried refund
	 * meets the key it was stored under.
	 */
	refundId?: string
	/** {@link orderDigestKey} of the secret; absent, a plain digest anyone can recompute. */
	key?: Buffer
}

const digestKeyOf = labelledKey('analytics:order-digest:v1')

/**
 * The key an order's dedupe digest is made with, derived from the instance's secret: every instance
 * sharing the secret keys an order alike, and nobody without it can test a guessed order number.
 */
export const orderDigestKey = (secret: unknown): Buffer | undefined =>
	typeof secret === 'string' && secret !== '' ? digestKeyOf(secret) : undefined

/**
 * The primary key a retried order lands on: the origin, then a keyed digest of the parts as JSON,
 * which leaves the origin out so a browser's and the server's record of one sale share it.
 */
export const dedupeKeyFor = ({
	goal,
	key,
	orderId,
	origin,
	refund,
	refundId,
	tenant,
}: DedupeKeyArgs): string => {
	const parts: unknown[] = [tenant ?? '', refund === true, goal, orderId]
	if (refund === true && refundId !== undefined) {
		parts.push(refundId)
	}
	const hash = key ? createHmac('sha256', key) : createHash('sha256')
	return `${DEDUPE_KEY_PREFIX[origin]}${hash.update(JSON.stringify(parts)).digest('hex')}`
}
