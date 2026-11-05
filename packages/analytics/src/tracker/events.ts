import { parseItemValue } from '../items/ref'
import { normalizeOrigin } from '../net/origin'
import { campaignQuery } from './campaign'
import type { ResolvedAutoCapture } from './config'
import type { ItemOptions, TrackerEvent, TrackerWindow } from './types'

/** An item a call named, with the name auto-capture read beside it for the vendor slots. */
export type ItemCall = ItemOptions & { itemName?: string }

/**
 * Where the page is, and the origin alone of where it was opened from: a same-origin navigation
 * puts the previous page's whole address in `document.referrer`, and ingest reads only its host.
 */
export const pageContext = (
	win: TrackerWindow
): Pick<TrackerEvent, 'path' | 'hostname' | 'referrer'> => {
	const referrer = win.document.referrer ? normalizeOrigin(win.document.referrer) : null
	return {
		path: win.location.pathname,
		hostname: win.location.hostname,
		...(referrer ? { referrer } : {}),
	}
}

/**
 * A pageview's campaign keys, repeated on its engagement, which counts no visit: an event fired
 * later would attribute the same visit twice. Absent `query` means on, for a cached snapshot.
 */
export const campaignFields = (
	win: TrackerWindow,
	autoCapture: ResolvedAutoCapture
): Pick<TrackerEvent, 'query'> => {
	if (autoCapture.query === false) {
		return {}
	}
	const campaign = campaignQuery(win.location.search)
	return campaign ? { query: campaign } : {}
}

/** The item fields of an event, for a well-formed ref only (signed or not): ingest drops anything else. */
export const itemFields = (opts: ItemCall | undefined): Pick<TrackerEvent, 'item' | 'itemName'> => {
	if (opts?.item === undefined || parseItemValue(opts.item) === null) {
		return {}
	}
	return { item: opts.item, ...(opts.itemName ? { itemName: opts.itemName } : {}) }
}
