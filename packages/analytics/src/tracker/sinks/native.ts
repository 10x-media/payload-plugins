import { sendPayload } from '../transport'
import type { Sink, TrackerEvent, TrackerWindow } from '../types'

/** How long a pageview waits for its duration before it is sent anyway. */
export const PAGEVIEW_BUFFER_MS = 10_000

/**
 * Posts events to the plugin's own ingest endpoint. Events and goals go out immediately;
 * a pageview is held so it can carry `durationMs` and the page's deepest scroll, and is
 * sent on the first of: the next navigation, `flush()` (which the tracker calls on
 * `pagehide`), or `PAGEVIEW_BUFFER_MS`. The tradeoff is bounded: a tab that dies inside
 * the window is caught by `pagehide`, and one killed without firing it loses that single
 * pageview rather than its duration.
 */
export const createNativeSink = (args: {
	slot: Sink['slot']
	win: TrackerWindow
	url: string
	/** Deepest scroll on the current page, read at flush time. */
	scrollDepth?: () => number | undefined
}): Sink => {
	const { slot, win, url, scrollDepth } = args
	let buffered: { event: TrackerEvent; startedAt: number } | null = null
	let timer: ReturnType<Window['setTimeout']> | null = null

	const clear = () => {
		if (timer !== null) {
			win.clearTimeout(timer)
			timer = null
		}
	}

	const flush = () => {
		const pending = buffered
		buffered = null
		clear()
		if (!pending) {
			return
		}
		const depth = scrollDepth?.()
		sendPayload(win, url, {
			...pending.event,
			durationMs: Math.max(0, Date.now() - pending.startedAt),
			...(depth === undefined ? {} : { scrollDepth: depth }),
		})
	}

	return {
		slot,
		ready: () => Promise.resolve(),
		send(event) {
			if (event.type !== 'pageview') {
				sendPayload(win, url, event)
				return
			}
			flush()
			buffered = { event, startedAt: Date.now() }
			timer = win.setTimeout(flush, PAGEVIEW_BUFFER_MS)
		},
		flush,
	}
}
