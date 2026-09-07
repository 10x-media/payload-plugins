import type { SnippetScript } from '../../core/capture'
import type { LoadScript, Sink, TrackerEvent, TrackerWindow } from '../types'

/** How often the sink re-checks for a vendor global that has not appeared yet. */
export const VENDOR_GLOBAL_POLL_MS = 100
/** How long it keeps checking before giving up on the event. */
export const VENDOR_GLOBAL_TIMEOUT_MS = 10_000

export interface VendorSinkArgs {
	slot: Sink['slot']
	win: TrackerWindow
	/** The slot's snippet scripts, in the order the adapter declared them. */
	scripts: readonly SnippetScript[]
	loadScript: LoadScript
}

/** What a vendor sink needs to know about its own global. */
export interface VendorTarget {
	/** True once the global is callable, stub or fully loaded SDK alike. */
	has(): boolean
	dispatch(event: TrackerEvent): void
}

const whenPresent = (win: TrackerWindow, target: VendorTarget): Promise<boolean> => {
	if (target.has()) {
		return Promise.resolve(true)
	}
	return new Promise((resolve) => {
		const deadline = Date.now() + VENDOR_GLOBAL_TIMEOUT_MS
		const check = () => {
			if (target.has()) {
				resolve(true)
				return
			}
			if (Date.now() >= deadline) {
				resolve(false)
				return
			}
			win.setTimeout(check, VENDOR_GLOBAL_POLL_MS)
		}
		win.setTimeout(check, VENDOR_GLOBAL_POLL_MS)
	})
}

/**
 * Shared body of every vendor sink: load the slot's snippet scripts once, in order, then
 * hand each event to the vendor global. Pageviews are dropped, because every supported
 * vendor script tracks its own and a forwarded one would double-count.
 *
 * Dispatch waits for the global to exist rather than for the load to resolve. PostHog and
 * Plausible publish a queueing stub the moment their inline snippet runs, so an event sent
 * before the SDK lands is queued and replayed by the SDK itself; Umami has no stub and its
 * `umami` appears only once the script has run, which is why this polls instead of assuming
 * the load promise is enough. An event whose global never turns up (an ad blocker, a CSP
 * rule, a 404 on the proxy) is dropped in silence after the timeout: never surfaced to the
 * visitor, never retried into a loop.
 */
export const createVendorSink = (args: VendorSinkArgs, target: VendorTarget): Sink => {
	let loading: Promise<void> | null = null

	const ready = (): Promise<void> => {
		loading ??= args.scripts.reduce(
			(chain, script) => chain.then(() => args.loadScript(script)),
			Promise.resolve<void>(undefined)
		)
		return loading
	}

	return {
		slot: args.slot,
		ready,
		send(event) {
			if (event.type === 'pageview') {
				return
			}
			if (target.has()) {
				target.dispatch(event)
				return
			}
			void ready()
				.then(() => whenPresent(args.win, target))
				.then((present) => {
					if (present) {
						target.dispatch(event)
					}
				})
				.catch(() => undefined)
		},
	}
}

/** Event name on the wire: a goal travels under its slug. */
export const vendorEventName = (event: TrackerEvent): string => event.name ?? ''

/** `props` merged with the revenue fields, each key present only when it has a value. */
export const flatProps = (event: TrackerEvent): Record<string, unknown> => ({
	...event.props,
	...(event.value === undefined ? {} : { value: event.value }),
	...(event.currency === undefined ? {} : { currency: event.currency }),
})
