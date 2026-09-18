import type { Sink, TrackerWindow } from '../types'
import {
	createVendorSink,
	flatProps,
	type VendorSinkArgs,
	vendorEventName,
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

type UmamiWindow = TrackerWindow & { umami?: UmamiGlobal }

/**
 * Forwards events and goals to `umami.track`. Umami ships no queueing stub, so `umami`
 * exists only once its script has run and the sink waits for it. Umami has no revenue field
 * of its own either, so `value` and `currency` travel as event data alongside the props.
 */
export const createUmamiSink = (args: VendorSinkArgs): Sink =>
	createVendorSink(args, {
		exclude: vendorStorageExclusion(args.win, UMAMI_DISABLED_KEY, '1'),
		has: () => typeof (args.win as UmamiWindow).umami?.track === 'function',
		dispatch: (event) => {
			;(args.win as UmamiWindow).umami?.track(vendorEventName(event), flatProps(event))
		},
	})
