import type { Sink } from '../types'
import {
	createVendorSink,
	flatProps,
	type VendorSinkArgs,
	vendorEventName,
	vendorGlobal,
} from './vendor'

interface PosthogGlobal {
	capture(name: string, properties?: Record<string, unknown>): void
	/** https://posthog.com/docs/privacy/data-collection, and both are in the snippet's stub. */
	opt_out_capturing?(): void
	/** `captureEventName: false` skips the `$opt_in` event it would otherwise capture. */
	opt_in_capturing?(options?: { captureEventName?: string | false }): void
}

/**
 * Forwards events and goals to `posthog.capture`, revenue as `value` and `currency`. Exclusion is
 * PostHog's opt-out; lifting it captures no `$opt_in`, since an open gate lifts it every load.
 */
export const createPosthogSink = (args: VendorSinkArgs): Sink => {
	const posthog = () => vendorGlobal<PosthogGlobal>(args.win, 'posthog')
	let lifted: PosthogGlobal | null = null
	return createVendorSink(args, {
		exclude: (excluded) => {
			const sdk = posthog()
			if (excluded) {
				lifted = null
				sdk?.opt_out_capturing?.()
				return
			}
			// The tracker lifts again once the snippet ran, which reaches only a global the first lift missed.
			if (sdk === undefined || sdk === lifted) {
				return
			}
			lifted = sdk
			sdk.opt_in_capturing?.({ captureEventName: false })
		},
		has: () => typeof posthog()?.capture === 'function',
		dispatch: (event) => {
			posthog()?.capture(vendorEventName(event), {
				...flatProps(event),
				// PostHog properties are arbitrary JSON, so the lines of a sale travel whole.
				...(event.items === undefined ? {} : { items: event.items }),
			})
		},
	})
}
