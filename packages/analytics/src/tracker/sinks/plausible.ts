import { readStorage } from '../storage'
import type { Sink } from '../types'
import {
	createVendorSink,
	itemProps,
	orderProps,
	type VendorSinkArgs,
	vendorEventName,
	vendorGlobal,
	vendorStorageSwitch,
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

type Plausible = ((name: string, options?: PlausibleOptions) => void) & {
	/** Set once Plausible's script replaced the snippet's queue stub. */
	l?: boolean
}

/**
 * Forwards events and goals to the `plausible` queue, revenue in its ecommerce shape. Props are
 * scalars, so a sale's lines are left out and its order id travels as the `orderId` prop.
 */
export const createPlausibleSink = (args: VendorSinkArgs): Sink => {
	const plausible = () => vendorGlobal<Plausible>(args.win, 'plausible')
	const ignore = vendorStorageSwitch(args.win, PLAUSIBLE_IGNORE_KEY, 'true')
	return createVendorSink(args, {
		mode: (next) => {
			ignore(next)
			// A running script checks the flag only on a pageview, and until one it keeps sending its
			// own engagement whenever the tab is hidden: a pageview it ignores stops that for the page.
			// With storage blocked the flag is not there, and the pageview would be counted.
			const sdk = plausible()
			if (
				next.mode === 'off' &&
				sdk?.l === true &&
				readStorage(args.win, PLAUSIBLE_IGNORE_KEY) === 'true'
			) {
				sdk('pageview')
			}
		},
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
