import type { Sink, TrackerWindow } from '../types'
import { createVendorSink, flatProps, type VendorSinkArgs, vendorEventName } from './vendor'

interface PosthogGlobal {
	capture(name: string, properties?: Record<string, unknown>): void
	/** https://posthog.com/docs/privacy/data-collection, and both are in the snippet's stub. */
	opt_out_capturing?(): void
	opt_in_capturing?(): void
}

type PosthogWindow = TrackerWindow & { posthog?: PosthogGlobal }

/**
 * Forwards events and goals to `posthog.capture`. Revenue rides along as the `value` and
 * `currency` properties, which is what PostHog's own revenue analytics reads. The adapter's
 * snippet publishes PostHog's queueing stub, so `capture` is callable (and replayed) from
 * the moment the snippet runs, well before `array.js` lands.
 *
 * Exclusion goes through PostHog's own opt-out, which the stub queues like any other call.
 * A slot whose snippet has not run has no global to opt out of, and none is loaded while
 * the tracker is excluded.
 */
export const createPosthogSink = (args: VendorSinkArgs): Sink =>
	createVendorSink(args, {
		exclude: (excluded) => {
			const { posthog } = args.win as PosthogWindow
			if (excluded) {
				posthog?.opt_out_capturing?.()
				return
			}
			posthog?.opt_in_capturing?.()
		},
		has: () => typeof (args.win as PosthogWindow).posthog?.capture === 'function',
		dispatch: (event) => {
			;(args.win as PosthogWindow).posthog?.capture(vendorEventName(event), flatProps(event))
		},
	})
