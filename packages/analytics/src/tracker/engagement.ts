import { MAX_ENGAGEMENT_MS, MAX_SINCE_MS } from '../goals/constants'
import type { TrackerEvent, TrackerWindow } from './types'

/**
 * Engaged time below this, with no deeper scroll and no item seen either, is not worth a
 * message of its own.
 */
export const ENGAGEMENT_MIN_MS = 1000

/** Ms since `at` on the page's monotonic clock, rounded and held between zero and a day. */
export const msSince = (win: TrackerWindow, at: number): number =>
	Math.min(MAX_SINCE_MS, Math.max(0, Math.round(win.performance.now() - at)))

/** What an engagement repeats from its pageview, so ingest files both under the same buckets. */
export type EngagementContext = Pick<TrackerEvent, 'path' | 'hostname' | 'referrer' | 'query'>

export interface Engagement {
	/** Measures a new pageview from now on; whatever the previous one had not sent is dropped. */
	start(context: EngagementContext): void
	/**
	 * Dispatches what the open pageview gained since its last engagement (time, scroll, items
	 * seen), if it gained anything.
	 */
	send(): void
	/** Stops measuring until the next `start`, sending nothing. */
	stop(): void
	destroy(): void
}

/**
 * Measures the open pageview after it was sent (visible time, deeper scroll, items seen); each
 * message carries only what is new since the previous one.
 */
export const createEngagement = (args: {
	win: TrackerWindow
	/** The deepest scroll on the open page, 0-100, or undefined while scroll capture is off. */
	scrollDepth: () => number | undefined
	/** The refs of the items seen since the previous message, handed over and forgotten. */
	takeImpressions?: () => string[]
	dispatch: (event: TrackerEvent) => void
}): Engagement => {
	const { win, scrollDepth, takeImpressions, dispatch } = args
	let context: EngagementContext | null = null
	/** When the open pageview was sent, on the page's monotonic clock. */
	let sentAt = 0
	let pendingMs = 0
	let visibleSince: number | null = null
	let reportedDepth = 0
	/** Set between `pagehide` and a back/forward cache restore, when the page is not running. */
	let frozen = false

	const pause = () => {
		if (visibleSince !== null) {
			pendingMs += Math.max(0, win.performance.now() - visibleSince)
			visibleSince = null
		}
	}

	const resume = () => {
		if (
			context !== null &&
			!frozen &&
			visibleSince === null &&
			win.document.visibilityState === 'visible'
		) {
			visibleSince = win.performance.now()
		}
	}

	/** A layout read in a document being torn down can throw; the time still counts without it. */
	const readDepth = (): number | undefined => {
		try {
			return scrollDepth()
		} catch {
			return undefined
		}
	}

	const send = () => {
		if (context === null) {
			return
		}
		pause()
		const depth = readDepth()
		const deeper = depth === undefined ? 0 : Math.max(0, depth - reportedDepth)
		const impressions = takeImpressions?.() ?? []
		if (pendingMs >= ENGAGEMENT_MIN_MS || deeper > 0 || impressions.length > 0) {
			const durationMs = Math.min(pendingMs, MAX_ENGAGEMENT_MS)
			pendingMs = 0
			reportedDepth += deeper
			dispatch({
				type: 'engagement',
				...context,
				sinceMs: msSince(win, sentAt),
				...(durationMs > 0 ? { durationMs } : {}),
				...(deeper > 0 ? { scrollDepth: deeper } : {}),
				...(impressions.length > 0 ? { impressions } : {}),
			})
		}
		resume()
	}

	const stop = () => {
		context = null
		pendingMs = 0
		visibleSince = null
		reportedDepth = 0
	}

	const onVisibilityChange = () => {
		if (win.document.visibilityState === 'visible') {
			resume()
			return
		}
		send()
	}

	const onPageHide = () => {
		frozen = true
		send()
	}

	const onPageShow = (event: PageTransitionEvent) => {
		frozen = false
		if (event.persisted) {
			resume()
		}
	}

	win.document.addEventListener('visibilitychange', onVisibilityChange)
	win.addEventListener('pagehide', onPageHide)
	win.addEventListener('pageshow', onPageShow)

	return {
		start(next) {
			stop()
			context = next
			sentAt = win.performance.now()
			resume()
		},
		send,
		stop,
		destroy() {
			stop()
			win.document.removeEventListener('visibilitychange', onVisibilityChange)
			win.removeEventListener('pagehide', onPageHide)
			win.removeEventListener('pageshow', onPageShow)
		},
	}
}
