import type { SlotMode } from '../config'
import { sendPayload } from '../transport'
import type { Sink, TrackerWindow } from '../types'

/**
 * How a beacon says the page measured it: `c` cookieless, `a` anonymous. Full sends none, as a
 * tracker from before modes did; anything but those three reads as the strictest.
 */
const wireMode = (mode: SlotMode): 'c' | 'a' | undefined => {
	if (mode === 'full') {
		return undefined
	}
	return mode === 'cookieless' ? 'c' : 'a'
}

/**
 * Posts every event to the plugin's own ingest endpoint the moment it is sent, stamped with the
 * slot's mode at that moment. An item's display name stays behind: it is for the vendor slots, and
 * native stores the ref alone. Anonymous keeps no engagement, so none is sent.
 */
export const createNativeSink = (args: {
	slot: Sink['slot']
	win: TrackerWindow
	url: string
	/** The slot's mode as each event is sent. Unset, every event is sent in full. */
	mode?: () => SlotMode
}): Sink => {
	const { slot, win, url } = args
	return {
		slot,
		ready: () => Promise.resolve(),
		send(event) {
			const m = wireMode(args.mode?.() ?? 'full')
			if (m === 'a' && event.type === 'engagement') {
				return
			}
			const { itemName: _itemName, ...wire } = event
			sendPayload(win, url, m === undefined ? wire : { ...wire, m })
		},
	}
}
