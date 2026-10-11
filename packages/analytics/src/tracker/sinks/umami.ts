import type { Sink } from '../types'
import {
	createVendorSink,
	flatProps,
	type VendorSinkArgs,
	vendorEventName,
	vendorGlobal,
	vendorStorageExclusion,
} from './vendor'

/**
 * Umami's own opt-out flag, which its script checks before it sends anything
 * (https://docs.umami.is/docs/exclude-my-own-visits). Per site, like the exclusion itself.
 */
export const UMAMI_DISABLED_KEY = 'umami.disabled'

interface UmamiGlobal {
	track(name: string, data?: Record<string, unknown>): void
}

/**
 * Forwards events and goals to `umami.track`, revenue as event data since Umami has no field for it.
 * Event data holds scalars, so a sale's lines are left out rather than flattened.
 */
export const createUmamiSink = (args: VendorSinkArgs): Sink => {
	const umami = () => vendorGlobal<UmamiGlobal>(args.win, 'umami')
	return createVendorSink(args, {
		exclude: vendorStorageExclusion(args.win, UMAMI_DISABLED_KEY, '1'),
		has: () => typeof umami()?.track === 'function',
		dispatch: (event) => {
			umami()?.track(vendorEventName(event), flatProps(event))
		},
	})
}
