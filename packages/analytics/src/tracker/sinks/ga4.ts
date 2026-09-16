import type { Sink, TrackerWindow } from '../types'
import { createVendorSink, flatProps, type VendorSinkArgs, vendorEventName } from './vendor'

type GtagWindow = TrackerWindow & {
	gtag?: (command: 'event', name: string, params?: Record<string, unknown>) => void
}

/**
 * Forwards events and goals to `gtag('event', name, params)`. Revenue rides along as the
 * `value` and `currency` params, which is what GA4's own ecommerce reports read. The inline
 * half of the snippet defines `gtag` and its `dataLayer` queue the moment it runs, so calls
 * made before gtag.js lands are replayed by it.
 *
 * Pageviews are dropped by `createVendorSink`, as for every other vendor: `gtag('config', id)`
 * sends the first page_view itself, and enhanced measurement (on by default for a web data
 * stream) sends one per history change, so a forwarded pageview would only double-count.
 */
export const createGa4Sink = (args: VendorSinkArgs): Sink =>
	createVendorSink(args, {
		has: () => typeof (args.win as GtagWindow).gtag === 'function',
		dispatch: (event) => {
			;(args.win as GtagWindow).gtag?.('event', vendorEventName(event), flatProps(event))
		},
	})
