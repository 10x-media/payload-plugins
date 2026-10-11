import { sendPayload } from '../transport'
import type { Sink, TrackerWindow } from '../types'

/**
 * Posts every event to the plugin's own ingest endpoint the moment it is sent. An item's
 * display name stays behind: it is for the vendor slots, and native stores the ref alone.
 */
export const createNativeSink = (args: {
	slot: Sink['slot']
	win: TrackerWindow
	url: string
}): Sink => {
	const { slot, win, url } = args
	return {
		slot,
		ready: () => Promise.resolve(),
		send(event) {
			const { itemName: _itemName, ...wire } = event
			sendPayload(win, url, wire)
		},
	}
}
