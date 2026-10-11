import type { Sink } from '../types'
import {
	createVendorSink,
	itemProps,
	orderProps,
	type VendorSinkArgs,
	vendorEventName,
	vendorGlobal,
	vendorStorageExclusion,
} from './vendor'

/**
 * Plausible's own opt-out flag, which its script checks before every event
 * (https://plausible.io/docs/excluding-localstorage).
 */
export const PLAUSIBLE_IGNORE_KEY = 'plausible_ignore'

interface PlausibleOptions {
	props?: Record<string, unknown>
	revenue?: { amount: number; currency?: string }
}

type Plausible = (name: string, options?: PlausibleOptions) => void

/**
 * Forwards events and goals to the `plausible` queue, revenue in its ecommerce shape. Props are
 * scalars, so a sale's lines are left out and its order id travels as the `orderId` prop.
 */
export const createPlausibleSink = (args: VendorSinkArgs): Sink => {
	const plausible = () => vendorGlobal<Plausible>(args.win, 'plausible')
	return createVendorSink(args, {
		exclude: vendorStorageExclusion(args.win, PLAUSIBLE_IGNORE_KEY, 'true'),
		has: () => typeof plausible() === 'function',
		dispatch: (event) => {
			const props = { ...event.props, ...orderProps(event), ...itemProps(event) }
			const options: PlausibleOptions = {
				...(Object.keys(props).length > 0 ? { props } : {}),
				...(event.value === undefined
					? {}
					: {
							revenue: {
								amount: event.value,
								...(event.currency === undefined ? {} : { currency: event.currency }),
							},
						}),
			}
			plausible()?.(vendorEventName(event), options)
		},
	})
}
