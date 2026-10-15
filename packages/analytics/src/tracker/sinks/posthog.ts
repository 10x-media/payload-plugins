import type { Sink, TrackerEvent } from '../types'
import {
	createVendorSink,
	flatProps,
	type VendorSinkArgs,
	vendorEventName,
	vendorGlobal,
} from './vendor'

interface PosthogClient {
	capture(name: string, properties?: Record<string, unknown>): void
	/** https://posthog.com/docs/privacy/data-collection, and both are in the snippet's stub. */
	opt_out_capturing?(): void
	/** `captureEventName: false` skips the `$opt_in` event it would otherwise capture. */
	opt_in_capturing?(options?: { captureEventName?: string | false }): void
	/** Set by a loaded posthog-js, false until the client's own `init` ran; the stub has none. */
	__loaded?: boolean
}

export interface PosthogSinkArgs extends VendorSinkArgs {
	/** The named client (`window.posthog[instance]`) the slot captures with; absent, the primary one. */
	instance?: string
}

const namedClient = (primary: unknown, instance: string): PosthogClient | undefined => {
	if (typeof primary !== 'object' || primary === null) {
		return undefined
	}
	const client: unknown = Reflect.get(primary, instance)
	return client as PosthogClient | undefined
}

/**
 * Where a pageview was, since a queued one is captured after the address may have moved on; the URL
 * carries only the query the tracker kept (campaign keys), as the event does.
 */
const pageviewProps = (event: TrackerEvent, protocol: string): Record<string, unknown> => ({
	$current_url: `${protocol}//${event.hostname}${event.path}${event.query ? `?${event.query}` : ''}`,
	$pathname: event.path,
	$host: event.hostname,
})

/**
 * Forwards events and goals to `posthog.capture`, revenue as `value` and `currency`. Exclusion is
 * PostHog's opt-out; lifting it captures no `$opt_in`, since an open gate lifts it every load. A
 * named client also gets the tracker's pageviews, as it counts none of its own.
 */
export const createPosthogSink = (args: PosthogSinkArgs): Sink => {
	const { instance } = args
	/**
	 * The slot's client once it can capture. A posthog-js the other slot's snippet loaded holds the
	 * primary client uninitialised until this slot's own `init` runs, and drops what it is given.
	 */
	const posthog = (): PosthogClient | undefined => {
		const primary = vendorGlobal<PosthogClient>(args.win, 'posthog')
		const client = instance === undefined ? primary : namedClient(primary, instance)
		return client?.__loaded === false ? undefined : client
	}
	let lifted: PosthogClient | null = null
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
		...(instance === undefined ? {} : { pageviews: true }),
		dispatch: (event) => {
			if (event.type === 'pageview') {
				posthog()?.capture('$pageview', pageviewProps(event, args.win.location.protocol))
				return
			}
			posthog()?.capture(vendorEventName(event), {
				...flatProps(event),
				// PostHog properties are arbitrary JSON, so the lines of a sale travel whole.
				...(event.items === undefined ? {} : { items: event.items }),
			})
		},
	})
}
