import type { Sink, TrackerWindow } from '../types'
import {
	createVendorSink,
	type VendorSinkArgs,
	vendorEventName,
	vendorStorageExclusion,
} from './vendor'

/**
 * Plausible's own opt-out flag, which its script checks before every event
 * (https://plausible.io/docs/excluding-localstorage). Set it and the script logs
 * "Ignoring Event: localStorage flag" instead of counting the visit.
 */
export const PLAUSIBLE_IGNORE_KEY = 'plausible_ignore'

interface PlausibleOptions {
	props?: Record<string, unknown>
	revenue?: { amount: number; currency?: string }
}

type PlausibleWindow = TrackerWindow & {
	plausible?: (name: string, options?: PlausibleOptions) => void
}

/**
 * Forwards events and goals to the `plausible` queue function. Revenue uses Plausible's
 * documented ecommerce shape, `{ revenue: { amount, currency } }`
 * (https://plausible.io/docs/ecommerce-revenue-tracking). The per-site snippet publishes the
 * `plausible.q` stub, so calls made before the tracker loads are replayed by it.
 */
export const createPlausibleSink = (args: VendorSinkArgs): Sink =>
	createVendorSink(args, {
		exclude: vendorStorageExclusion(args.win, PLAUSIBLE_IGNORE_KEY, 'true'),
		has: () => typeof (args.win as PlausibleWindow).plausible === 'function',
		dispatch: (event) => {
			const options: PlausibleOptions = {
				...(event.props ? { props: event.props } : {}),
				...(event.value === undefined
					? {}
					: {
							revenue: {
								amount: event.value,
								...(event.currency === undefined ? {} : { currency: event.currency }),
							},
						}),
			}
			;(args.win as PlausibleWindow).plausible?.(vendorEventName(event), options)
		},
	})
