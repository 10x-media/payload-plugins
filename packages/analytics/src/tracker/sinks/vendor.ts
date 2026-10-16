import { monotonicMs } from '../../core/monotonic'
import { bareItemRef } from '../../items/ref'
import type { SnippetScript } from '../config'
import { writeStorage } from '../storage'
import type {
	LoadScript,
	Sink,
	TrackerEvent,
	TrackerWindow,
	VendorMode,
	VendorSwitch,
} from '../types'

/** How often the sink re-checks for a vendor global that has not appeared yet. */
export const VENDOR_GLOBAL_POLL_MS = 100
/** How long it keeps checking before giving up on the event. */
export const VENDOR_GLOBAL_TIMEOUT_MS = 10_000

export interface VendorSinkArgs {
	slot: Sink['slot']
	win: TrackerWindow
	/**
	 * The slot's snippet scripts, in the order the adapter declared them; a function is asked as they
	 * load, for a slot whose variant depends on the page.
	 */
	scripts: readonly SnippetScript[] | (() => readonly SnippetScript[])
	loadScript: LoadScript
}

/** What a vendor sink needs to know about its own global. */
export interface VendorTarget {
	/** True once the global is callable, stub or fully loaded SDK alike. */
	has(): boolean
	dispatch(event: TrackerEvent): void
	/**
	 * Switches the vendor's own client, for the vendors that document a switch. `from` is the mode this
	 * page last switched it to, null while it runs as its snippet started; once the slot's scripts ran,
	 * the current switch is applied again with `from` equal to it, so a repeat must be harmless.
	 */
	mode?(next: VendorSwitch, from: VendorMode | null): void
	/** See {@link Sink.forget}. */
	forget?(): void
	/** The vendor client counts no pageview itself, so it is handed the tracker's. */
	pageviews?: boolean
}

/**
 * `mode` for a vendor that stores nothing on the device and whose opt-out is a `localStorage` key:
 * off sets it, full clears it, and cookieless leaves it, since nothing is written before consent.
 * Blocked storage is not a failure: the vendor's script reads the same storage and finds the same nothing.
 */
export const vendorStorageSwitch =
	(win: TrackerWindow, key: string, value: string) =>
	(next: VendorSwitch): void => {
		if (next.mode !== 'cookieless') {
			writeStorage(win, key, next.mode === 'off' ? value : null)
		}
	}

/** Resolves true once `present()` holds, checked every {@link VENDOR_GLOBAL_POLL_MS}, false on timeout. */
export const whenPresent = (win: TrackerWindow, present: () => boolean): Promise<boolean> => {
	if (present()) {
		return Promise.resolve(true)
	}
	return new Promise((resolve) => {
		const deadline = monotonicMs() + VENDOR_GLOBAL_TIMEOUT_MS
		const check = () => {
			if (present()) {
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
 * has no stub. Engagements are dropped, and pageviews unless the target asks: each vendor measures its own.
 */
export const createVendorSink = (args: VendorSinkArgs, target: VendorTarget): Sink => {
	let loading: Promise<void> | null = null
	/** The switch this page last applied, null while the client runs as its snippet started. */
	let applied: VendorSwitch | null = null

	const ready = (): Promise<void> => {
		const scripts = typeof args.scripts === 'function' ? args.scripts() : args.scripts
		loading ??= scripts
			.reduce(
				(chain, script) => chain.then(() => args.loadScript(script)),
				Promise.resolve<void>(undefined)
			)
			.then(() => {
				// A vendor whose snippet defines its global (PostHog) had none to switch before it ran.
				if (applied !== null) {
					target.mode?.(applied, applied.mode)
				}
			})
		return loading
	}

	const switchTo = target.mode
		? (next: VendorSwitch) => {
				if (applied?.mode === next.mode && applied.refused === next.refused) {
					return
				}
				const from = applied?.mode ?? null
				applied = next
				target.mode?.(next, from)
			}
		: undefined

	return {
		slot: args.slot,
		ready,
		...(switchTo ? { mode: switchTo } : {}),
		...(target.forget ? { forget: target.forget } : {}),
		send(event) {
			if (event.type === 'engagement' || (event.type === 'pageview' && !target.pageviews)) {
				return
			}
			if (target.has()) {
				target.dispatch(event)
				return
			}
			void ready()
				.then(() => whenPresent(args.win, () => target.has()))
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
