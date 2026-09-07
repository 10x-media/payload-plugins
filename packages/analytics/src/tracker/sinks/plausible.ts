import type { Sink, TrackerWindow } from '../types'
import { createVendorSink, type VendorSinkArgs, vendorEventName } from './vendor'

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
 * (https://plausible.io/docs/ecommerce-revenue-tracking).
 */
export const createPlausibleSink = (args: VendorSinkArgs): Sink =>
	createVendorSink(args, (event) => {
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
	})
