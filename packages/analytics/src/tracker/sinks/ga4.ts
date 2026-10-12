import { ga4DisableKey } from '../../adapters/ga4/disableKey'
import { ga4EventName } from '../../adapters/ga4/eventName'
import { ITEM_CLICK_EVENT } from '../../goals/constants'
import { bareItemRef } from '../../items/ref'
import type { Sink, TrackerEvent, TrackerWindow } from '../types'
import {
	createVendorSink,
	flatProps,
	type VendorSinkArgs,
	vendorEventName,
	vendorGlobal,
} from './vendor'

interface Gtag {
	(command: 'event', name: string, params?: Record<string, unknown>): void
	(command: 'consent', action: 'update', params: Record<string, 'granted' | 'denied'>): void
}

/**
 * Consent mode's update telling a tag that already ran to stop using its cookies: every storage
 * type it reads, analytics and advertising alike.
 */
const GA4_DENIED_CONSENT: Readonly<Record<string, 'denied'>> = Object.freeze({
	analytics_storage: 'denied',
	ad_storage: 'denied',
	ad_user_data: 'denied',
	ad_personalization: 'denied',
})

/** GA4's own event for a click on a promotion, which is what a click on a content item is. */
const GA4_ITEM_CLICK_EVENT = 'select_promotion'

/**
 * Whether this measurement id's tag ran on the page: its `gtag('config', id)` is in the
 * `dataLayer`, as an `arguments` object, which gtag.js leaves there once it has read it.
 */
const configured = (win: TrackerWindow, measurementId: string): boolean => {
	const layer: unknown = Reflect.get(win, 'dataLayer')
	return (
		Array.isArray(layer) &&
		layer.some(
			(entry: unknown) =>
				typeof entry === 'object' &&
				entry !== null &&
				Reflect.get(entry, 0) === 'config' &&
				Reflect.get(entry, 1) === measurementId
		)
	)
}

export interface Ga4SinkArgs extends VendorSinkArgs {
	/** From the slot's client descriptor: the switch is per measurement id. */
	measurementId?: string
}

/**
 * A click on a content item in GA4's promotion vocabulary, so its own promotion reports read
 * it: the ref as `promotion_id` and as the one line's `item_id`, its name beside both.
 */
const promotionParams = (event: TrackerEvent & { item: string }): Record<string, unknown> => {
	const id = bareItemRef(event.item)
	const name = event.itemName
	return {
		...event.props,
		promotion_id: id,
		...(name === undefined ? {} : { promotion_name: name }),
		items: [{ item_id: id, ...(name === undefined ? {} : { item_name: name }) }],
	}
}

const isItemClickEvent = (event: TrackerEvent): event is TrackerEvent & { item: string } =>
	event.type === 'event' && event.name === ITEM_CLICK_EVENT && event.item !== undefined

/**
 * Forwards events and goals to `gtag('event')` under GA4-safe names, sales with `transaction_id` and
 * `items`. No pageviews: enhanced measurement counts navigations and must stay on for the stream.
 */
export const createGa4Sink = ({ measurementId, ...args }: Ga4SinkArgs): Sink => {
	const gtag = () => vendorGlobal<Gtag>(args.win, 'gtag')
	return createVendorSink(args, {
		...(measurementId
			? {
					// The rendered snippet sets the switch for itself; re-asserting it covers a gated
					// slot, whose snippet this sink injects, and a runtime flip either way.
					exclude: (excluded: boolean) => {
						Reflect.set(args.win, ga4DisableKey(measurementId), excluded)
						// Google honours the switch only before the first gtag() call, so a tag that ran is denied
						// storage too; nothing grants it back, since the host's own consent mode may hold it.
						const tag = gtag()
						if (excluded && typeof tag === 'function' && configured(args.win, measurementId)) {
							tag('consent', 'update', { ...GA4_DENIED_CONSENT })
						}
					},
				}
			: {}),
		has: () => typeof gtag() === 'function',
		dispatch: (event) => {
			if (isItemClickEvent(event)) {
				gtag()?.('event', GA4_ITEM_CLICK_EVENT, promotionParams(event))
				return
			}
			gtag()?.('event', ga4EventName(vendorEventName(event)), {
				...flatProps(event),
				...(event.orderId === undefined ? {} : { transaction_id: event.orderId }),
				...(event.items === undefined ? {} : { items: event.items }),
			})
		},
	})
}
