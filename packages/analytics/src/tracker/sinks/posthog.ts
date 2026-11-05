import type { Sink, TrackerEvent } from '../types'
import {
	createVendorSink,
	flatProps,
	VENDOR_GLOBAL_POLL_MS,
	type VendorSinkArgs,
	vendorEventName,
	vendorGlobal,
} from './vendor'

/** posthog-js's `cookieless_mode`, and `false` for none: `undefined` would leave the setting as it is. */
type CookielessSetting = 'on_reject' | false

interface PosthogClient {
	capture(name: string, properties?: Record<string, unknown>): void
	/** https://posthog.com/docs/privacy/data-collection, and both are in the snippet's stub. */
	opt_out_capturing?(): void
	/** `captureEventName: false` skips the `$opt_in` event it would otherwise capture. */
	opt_in_capturing?(options?: { captureEventName?: string | false }): void
	/** Only a loaded posthog-js answers; the stub queues the call and returns nothing. */
	has_opted_in_capturing?(): boolean
	/** Not in the stub. */
	set_config?(config: { cookieless_mode: CookielessSetting }): void
	/** Set by a loaded posthog-js, false until the client's own `init` ran; the stub has none. */
	__loaded?: boolean
}

export interface PosthogSinkArgs extends VendorSinkArgs {
	/** The named client (`window.posthog[instance]`) the slot captures with; absent, the primary one. */
	instance?: string
	/**
	 * True when the slot counts without consent in some phase, so its snippet booted the client with
	 * `cookieless_mode: 'on_reject'`: an opt-out returns it to cookieless rather than stopping it.
	 */
	cookieless?: boolean
	/** The project token the client was initialised with, which names its storage keys. */
	token?: string
}

const namedClient = (primary: unknown, instance: string): PosthogClient | undefined => {
	if (typeof primary !== 'object' || primary === null) {
		return undefined
	}
	const client: unknown = Reflect.get(primary, instance)
	return client as PosthogClient | undefined
}

/**
 * Sets `cookieless_mode` on the `init` the snippet's stub queued for `name`, which posthog-js runs
 * once it loads: set any later, its first pageview would already be sent as the stub started it.
 */
const setQueuedInit = (primary: unknown, name: string, setting: CookielessSetting): boolean => {
	const queue: unknown = Array.isArray(primary) ? Reflect.get(primary, '_i') : undefined
	if (!Array.isArray(queue)) {
		return false
	}
	let found = false
	for (const call of queue) {
		const options: unknown = Array.isArray(call) && call[2] === name ? call[1] : undefined
		if (typeof options === 'object' && options !== null) {
			Reflect.set(options, 'cookieless_mode', setting)
			found = true
		}
	}
	return found
}

/**
 * posthog-js's per-tab window id, which an opt-out leaves in `sessionStorage`: a revoke removes it, so
 * PostHog's own opt-out key is all that stays.
 */
export const posthogWindowIdKey = (token: string): string => `ph_${token}_window_id`

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
 * Forwards events and goals to `posthog.capture`, revenue as `value` and `currency`. Full is PostHog's
 * opt-in, off its opt-out, and a cookieless slot's client counts cookielessly while opted out; lifting
 * captures no `$opt_in`, since an open gate lifts it every load. A named client also gets the
 * tracker's pageviews, as it counts none of its own.
 */
export const createPosthogSink = (args: PosthogSinkArgs): Sink => {
	const { instance, win } = args
	/**
	 * The slot's client once it can capture. A posthog-js the other slot's snippet loaded holds the
	 * primary client uninitialised until this slot's own `init` runs, and drops what it is given.
	 */
	const posthog = (): PosthogClient | undefined => {
		const primary = vendorGlobal<PosthogClient>(win, 'posthog')
		const client = instance === undefined ? primary : namedClient(primary, instance)
		return client?.__loaded === false ? undefined : client
	}
	const loaded = (): boolean => posthog()?.__loaded === true
	let lifted: PosthogClient | null = null
	/** Whether this page turned the client's cookieless mode off, so an opt-out stops it entirely. */
	let stopped = false
	/** A refusal still to check against a grant PostHog kept, which only a loaded client can tell. */
	let refusing = false
	/** Whether the sink is waiting for the client to load, to check a refusal against a kept grant. */
	let watching = false

	const lift = () => {
		const sdk = posthog()
		// The sink lifts again once the snippet ran, which reaches only a global the first lift missed.
		if (sdk === undefined || sdk === lifted) {
			return
		}
		lifted = sdk
		sdk.opt_in_capturing?.({ captureEventName: false })
	}

	const optOut = () => {
		lifted = null
		posthog()?.opt_out_capturing?.()
	}

	/** Takes back a grant: the opt-out, then the window id posthog-js keeps past it. */
	const revoke = () => {
		optOut()
		if (args.token === undefined) {
			return
		}
		try {
			win.sessionStorage?.removeItem(posthogWindowIdKey(args.token))
		} catch {
			// Storage blocked: posthog-js could not have kept the id there either.
		}
	}

	const setCookieless = (on: boolean) => {
		if (!args.cookieless || stopped === !on) {
			return
		}
		const setting: CookielessSetting = on ? 'on_reject' : false
		const sdk = posthog()
		if (sdk?.__loaded === true && sdk.set_config) {
			sdk.set_config({ cookieless_mode: setting })
			stopped = !on
		} else if (setQueuedInit(vendorGlobal(win, 'posthog'), instance ?? 'posthog', setting)) {
			stopped = !on
		}
	}

	/**
	 * Puts a pending refusal to a loaded client: opted in only on the grant PostHog keeps in its own
	 * storage from an earlier page, it is revoked. A client that is not opted in is already counting
	 * cookielessly or stopped, and an opt-out would only write PostHog its consent key.
	 */
	const settleRefusal = (): boolean => {
		if (!refusing || !loaded()) {
			return false
		}
		refusing = false
		if (posthog()?.has_opted_in_capturing?.() === true) {
			revoke()
		}
		return true
	}

	/**
	 * A refusal waits for the client however long it takes to load (a host's own loader, a slow
	 * network), since a kept grant would run in full the moment it does; the page leaving ends the wait.
	 */
	const refuseKeptGrant = () => {
		refusing = true
		if (settleRefusal() || watching) {
			return
		}
		watching = true
		let timer: ReturnType<Window['setTimeout']> | undefined
		const stop = () => {
			watching = false
			win.clearTimeout(timer)
			win.removeEventListener('pagehide', stop)
		}
		const check = () => {
			if (!refusing || settleRefusal()) {
				stop()
				return
			}
			timer = win.setTimeout(check, VENDOR_GLOBAL_POLL_MS)
		}
		win.addEventListener('pagehide', stop)
		timer = win.setTimeout(check, VENDOR_GLOBAL_POLL_MS)
	}

	return createVendorSink(args, {
		mode: (next, from) => {
			refusing = false
			setCookieless(next.mode !== 'off')
			if (next.mode === 'full') {
				lift()
			} else if (from === 'full') {
				revoke()
			} else if (next.mode === 'off' && !args.cookieless) {
				optOut()
			} else if (next.mode === 'off' || next.refused) {
				// Booted opted out by default, the client stopped with its cookieless mode.
				refuseKeptGrant()
			}
		},
		has: () => {
			settleRefusal()
			return typeof posthog()?.capture === 'function'
		},
		...(instance === undefined ? {} : { pageviews: true }),
		dispatch: (event) => {
			if (event.type === 'pageview') {
				posthog()?.capture('$pageview', pageviewProps(event, win.location.protocol))
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
