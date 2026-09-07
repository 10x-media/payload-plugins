import type { SnippetScript } from '../../core/capture'
import type { LoadScript, Sink, TrackerEvent, TrackerWindow } from '../types'

export interface VendorSinkArgs {
	slot: Sink['slot']
	win: TrackerWindow
	/** The slot's snippet scripts, in the order the adapter declared them. */
	scripts: readonly SnippetScript[]
	loadScript: LoadScript
}

/**
 * Shared body of every vendor sink: load the slot's snippet scripts once, in order, then
 * hand each event to the vendor global. Pageviews are dropped, because every supported
 * vendor script tracks its own and a forwarded one would double-count. A script that fails
 * to load (an ad blocker, a CSP rule) leaves the sink permanently unloaded and its events
 * dropped in silence, which is the correct outcome for analytics: never surface to the
 * visitor, never retry into a loop.
 */
export const createVendorSink = (
	args: VendorSinkArgs,
	dispatch: (event: TrackerEvent) => void
): Sink => {
	let loading: Promise<void> | null = null
	let loaded = false

	const ready = (): Promise<void> => {
		loading ??= args.scripts
			.reduce(
				(chain, script) => chain.then(() => args.loadScript(script)),
				Promise.resolve<void>(undefined)
			)
			.then(() => {
				loaded = true
			})
		return loading
	}

	return {
		slot: args.slot,
		ready,
		send(event) {
			if (event.type === 'pageview') {
				return
			}
			if (loaded) {
				dispatch(event)
				return
			}
			void ready()
				.then(() => dispatch(event))
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
