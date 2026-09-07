import type { Sink, TrackerWindow } from '../types'
import { createVendorSink, flatProps, type VendorSinkArgs, vendorEventName } from './vendor'

interface UmamiGlobal {
	track(name: string, data?: Record<string, unknown>): void
}

type UmamiWindow = TrackerWindow & { umami?: UmamiGlobal }

/**
 * Forwards events and goals to `umami.track`. Umami has no revenue field of its own, so
 * `value` and `currency` travel as event data alongside the goal's props.
 */
export const createUmamiSink = (args: VendorSinkArgs): Sink =>
	createVendorSink(args, (event) => {
		;(args.win as UmamiWindow).umami?.track(vendorEventName(event), flatProps(event))
	})
