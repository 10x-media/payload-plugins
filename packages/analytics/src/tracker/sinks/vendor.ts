import { monotonicMs } from '../../core/monotonic'
import { bareItemRef } from '../../items/ref'
import type { SnippetScript } from '../config'
import { writeStorage } from '../storage'
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
	/** The vendor's own opt-out switch, for the vendors that document one. */
	exclude?(excluded: boolean): void
}

/**
 * `exclude` for vendors whose opt-out is a `localStorage` key. Blocked storage is not a failure:
 * the vendor's script reads the same storage and finds the same nothing.
 */
export const vendorStorageExclusion =
	(win: TrackerWindow, key: string, value: string) =>
	(excluded: boolean): void => {
		writeStorage(win, key, excluded ? value : null)
	}

const whenPresent = (win: TrackerWindow, target: VendorTarget): Promise<boolean> => {
	if (target.has()) {
		return Promise.resolve(true)
	}
	return new Promise((resolve) => {
		const deadline = monotonicMs() + VENDOR_GLOBAL_TIMEOUT_MS
		const check = () => {
			if (target.has()) {
				resolve(true)
				return
			}
			if (monotonicMs() >= deadline) {
				resolve(false)
				return
			}
			win.setTimeout(check, VENDOR_GLOBAL_POLL_MS)
		}
		win.setTimeout(check, VENDOR_GLOBAL_POLL_MS)
	})
}

/**
 * Loads the slot's snippets once, in order, and dispatches when the vendor global exists, since Umami
 * has no stub. Pageviews and engagements are dropped: every vendor measures its own.
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
		...(target.exclude ? { exclude: target.exclude } : {}),
		send(event) {
			if (event.type === 'pageview' || event.type === 'engagement') {
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

/**
 * A vendor's global, typed as its sink calls it. Unchecked: the sink's `has()` confirms it is
 * callable before a dispatch, and every call still goes through `?.`.
 */
export const vendorGlobal = <T>(win: TrackerWindow, name: string): T | undefined => {
	const value: unknown = Reflect.get(win, name)
	return value as T | undefined
}

/** Event name on the wire: a goal travels under its slug. */
export const vendorEventName = (event: TrackerEvent): string => event.name ?? ''

/** The item as every vendor receives it: `item` (the ref without its signature) and `item_name`. */
export const itemProps = (event: TrackerEvent): Record<string, string> => ({
	...(event.item === undefined ? {} : { item: bareItemRef(event.item) }),
	...(event.item === undefined || event.itemName === undefined
		? {}
		: { item_name: event.itemName }),
})

/** A sale's order id as the prop the vendors without a field of their own for it receive. */
export const orderProps = (event: TrackerEvent): Record<string, string> =>
	event.orderId === undefined ? {} : { orderId: event.orderId }

/** `props` merged with the order, revenue and item fields, each key present only with a value. */
export const flatProps = (event: TrackerEvent): Record<string, unknown> => ({
	...event.props,
	...orderProps(event),
	...(event.value === undefined ? {} : { value: event.value }),
	...(event.currency === undefined ? {} : { currency: event.currency }),
	...itemProps(event),
})
