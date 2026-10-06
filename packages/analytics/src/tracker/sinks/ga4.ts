import { ga4DisableKey } from '../../adapters/ga4/disableKey'
import { ga4EventName } from '../../adapters/ga4/eventName'
import type { Sink, TrackerWindow } from '../types'
import { createVendorSink, flatProps, type VendorSinkArgs, vendorEventName } from './vendor'

export { GA4_DISABLE_PREFIX } from '../../adapters/ga4/disableKey'

type GtagWindow = TrackerWindow & {
	gtag?: (command: 'event', name: string, params?: Record<string, unknown>) => void
}

export interface Ga4SinkArgs extends VendorSinkArgs {
	/** From the slot's client descriptor: the switch is per measurement id. */
	measurementId?: string
}

/**
 * Forwards events and goals to `gtag('event', name, params)`, under the name GA4 accepts for
 * them rather than the kebab-case slug: the other vendors take hyphens, GA4 does not. Revenue
 * rides along as the `value` and `currency` params, which is what GA4's own ecommerce reports
 * read. The inline half of the snippet defines `gtag` and its `dataLayer` queue the moment it
 * runs, so calls made before gtag.js lands are replayed by it.
 *
 * Pageviews are dropped by `createVendorSink`, as for every other vendor: `gtag('config', id)`
 * sends the first page view itself, and page views on history changes come from the web data
 * stream's enhanced measurement (https://support.google.com/analytics/answer/9216061), on by
 * default and switchable per stream. An install that turned that option off should turn it
 * back on: this sink forwards no pageview, because on a default stream it would double-count.
 */
export const createGa4Sink = ({ measurementId, ...args }: Ga4SinkArgs): Sink =>
	createVendorSink(args, {
		...(measurementId
			? {
					// The rendered snippet sets this for itself; re-asserting it covers a gated slot,
					// whose snippet this sink injects, and a runtime flip either way.
					exclude: (excluded: boolean) => {
						Reflect.set(args.win, ga4DisableKey(measurementId), excluded)
					},
				}
			: {}),
		has: () => typeof (args.win as GtagWindow).gtag === 'function',
		dispatch: (event) => {
			;(args.win as GtagWindow).gtag?.(
				'event',
				ga4EventName(vendorEventName(event)),
				flatProps(event)
			)
		},
	})
