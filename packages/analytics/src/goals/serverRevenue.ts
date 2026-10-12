import type { Payload } from 'payload'
import type { ServerTrackOptions } from '../core/serverEvent'
import { trackServerEvent } from '../native/ingest/serverTrack'
import type { RevenueItem } from '../tracker/config'
import { PURCHASE_GOAL_SLUG } from './constants'

/** Where a sale is filed when the call names no page: one path for every order, never its id. */
export const ORDERS_PATH = '/orders'

/** A sale, in the vocabulary GA4 uses for one. */
export interface PurchaseInput {
	/** The money that moved. */
	value: number
	/** ISO 4217. Taken to be the reporting currency when omitted. */
	currency?: string
	/**
	 * The order this amount belongs to. A second call with the same order and goal is ignored, so a
	 * payment provider may retry its webhook as often as it likes. Stored only as a digest.
	 */
	orderId: string
	/**
	 * Goal slug the sale is booked against. Defaults to `purchase`, which the plugin defines unless
	 * config or the collection claims it, so a sale counts with no goal declared.
	 */
	goal?: string
	/** The lines of the sale, capped and stored under the event's props. */
	items?: RevenueItem[]
	/**
	 * The content item the sale is credited to, as its `<collection>:<id>` ref: the offer or the
	 * product card the buyer came through. Kept only when that collection is bound as items.
	 */
	item?: string
	/** Site the sale belongs to. Defaults to the install's `serverURL` host. */
	hostname?: string
	/** The page the sale is filed under; `/orders` when unset. */
	path?: string
	scope?: string | null
	props?: Record<string, unknown>
	/** When the charge settled, refused out of range exactly as `trackServerEvent`'s `now` is. */
	timestamp?: Date
}

/** A refund. The sign belongs to the call, so the amount is passed as the positive it is. */
export interface RefundInput extends Omit<PurchaseInput, 'value'> {
	/** The money that came back, as a positive amount. */
	value: number
	/**
	 * The payment provider's refund id: each id counts once, so partial refunds each count and a retry
	 * is ignored. Stored only as a digest, like the order id.
	 */
	refundId: string
}

/**
 * A goal event carrying money, keyed by a digest of scope, goal and `orderId` (and `refundId`), so a
 * retried webhook writes once. An unmatched `goal` is recorded but completes nothing, logged once.
 */
const recordRevenue = async (
	payload: Payload,
	input: PurchaseInput & { refundId?: string },
	opts?: ServerTrackOptions
): Promise<void> => {
	await trackServerEvent(
		payload,
		{
			type: 'goal',
			name: input.goal ?? PURCHASE_GOAL_SLUG,
			path: input.path ?? ORDERS_PATH,
			hostname: input.hostname ?? new URL(payload.config.serverURL || 'http://localhost').hostname,
			value: input.value,
			revenue: true,
			orderId: input.orderId,
			...(input.refundId === undefined ? {} : { refundId: input.refundId }),
			...(input.currency ? { currency: input.currency } : {}),
			...(input.items ? { items: input.items } : {}),
			...(input.item ? { item: input.item } : {}),
			...(input.props ? { props: input.props } : {}),
			...(input.scope !== undefined ? { scope: input.scope } : {}),
			...(input.timestamp ? { now: input.timestamp } : {}),
		},
		opts
	)
}

/**
 * Records a sale from server code (a payment webhook, a job, a server action) with its real total,
 * not the goal's fixed worth. Needs the native adapter; `orderId` makes retries safe.
 */
export const purchase = (
	payload: Payload,
	input: PurchaseInput,
	opts?: ServerTrackOptions
): Promise<void> => recordRevenue(payload, input, opts)

/**
 * Records a refund as a negative completion: revenue falls, conversions stand. The sign is applied
 * here whatever the provider sends; a missing or invalid `refundId` throws `AnalyticsTrackError`.
 */
export const refund = (
	payload: Payload,
	input: RefundInput,
	opts?: ServerTrackOptions
): Promise<void> => recordRevenue(payload, { ...input, value: -Math.abs(input.value) }, opts)
