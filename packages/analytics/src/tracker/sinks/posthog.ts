import type { Sink, TrackerWindow } from '../types'
import { createVendorSink, flatProps, type VendorSinkArgs, vendorEventName } from './vendor'

interface PosthogGlobal {
	capture(name: string, properties?: Record<string, unknown>): void
}

type PosthogWindow = TrackerWindow & { posthog?: PosthogGlobal }

/**
 * Forwards events and goals to `posthog.capture`. Revenue rides along as the `value` and
 * `currency` properties, which is what PostHog's own revenue analytics reads. The adapter's
 * snippet publishes PostHog's queueing stub, so `capture` is callable (and replayed) from
 * the moment the snippet runs, well before `array.js` lands.
 */
export const createPosthogSink = (args: VendorSinkArgs): Sink =>
	createVendorSink(args, {
		has: () => typeof (args.win as PosthogWindow).posthog?.capture === 'function',
		dispatch: (event) => {
			;(args.win as PosthogWindow).posthog?.capture(vendorEventName(event), flatProps(event))
		},
	})
