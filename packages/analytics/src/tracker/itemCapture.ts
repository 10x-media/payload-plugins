import { ITEM_ATTRIBUTE, MAX_ITEMS_PER_BEACON } from '../goals/constants'
import { parseItemValue } from '../items/ref'
import type { TrackerWindow } from './types'

/** How long an item has to stay visible enough, without a break, before it counts as seen. */
export const ITEM_SEEN_MS = 1000

/** How much of an item has to be on screen; for one taller than the screen, how much of the screen. */
const ITEM_VISIBLE_SHARE = 0.5

const THRESHOLDS = [0, ITEM_VISIBLE_SHARE, 1]

/** The rescan's delay where the browser has no idle callback to offer. */
const RESCAN_FALLBACK_MS = 200

/** The longest an idle rescan may wait, so a page that never idles is still scanned. */
const RESCAN_TIMEOUT_MS = 1000

export interface ItemCapture {
	/** Starts watching the page. A second call while it runs does nothing. */
	start(): void
	/** Stops watching and drops what was seen and not yet taken, as if it had never been seen. */
	stop(): void
	/** A new pageview: every item may count once more, and the page is scanned again. */
	resetPage(): void
	/** The refs seen since the previous take, in the order they were seen. Emptied by the call. */
	take(): string[]
	destroy(): void
}

interface Candidate {
	ref: string
	/** What the latest intersection said: visible enough to start or keep the clock running. */
	visible: boolean
	/** Intersecting and taller than the screen, so scrolling decides without the observer firing. */
	tall: boolean
	timer: number | null
}

/**
 * Reports each marked content item once per pageview, when enough of it stays visible for
 * {@link ITEM_SEEN_MS} with the tab in front. Without IntersectionObserver it reports nothing.
 */
export const createItemCapture = (args: {
	win: TrackerWindow
	/** Called when the seen refs reach what one message carries, so they go out early. */
	onFull: () => void
}): ItemCapture => {
	const { win, onFull } = args
	const doc = win.document
	const candidates = new Map<Element, Candidate>()
	const seen = new Set<string>()
	let pending: string[] = []
	let running = false
	let intersections: IntersectionObserver | null = null
	let mutations: MutationObserver | null = null
	let rescanHandle: { idle: number } | { timeout: number } | null = null
	let frame: number | null = null

	const viewportHeight = (): number => win.innerHeight || doc.documentElement?.clientHeight || 0

	const clearClock = (candidate: Candidate) => {
		if (candidate.timer !== null) {
			win.clearTimeout(candidate.timer)
			candidate.timer = null
		}
	}

	const visibleByStyle = (el: Element): boolean => {
		if (typeof el.checkVisibility !== 'function') {
			return true
		}
		try {
			return el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
		} catch {
			return true
		}
	}

	const record = (el: Element, candidate: Candidate) => {
		candidate.timer = null
		if (
			!candidate.visible ||
			seen.has(candidate.ref) ||
			doc.visibilityState !== 'visible' ||
			!el.isConnected ||
			!visibleByStyle(el)
		) {
			return
		}
		seen.add(candidate.ref)
		pending.push(candidate.ref)
		if (pending.length >= MAX_ITEMS_PER_BEACON) {
			onFull()
		}
	}

	/** Runs the clock while the item is visible enough in a tab in front, and stops it otherwise. */
	const clock = (el: Element, candidate: Candidate) => {
		if (!candidate.visible || seen.has(candidate.ref) || doc.visibilityState !== 'visible') {
			clearClock(candidate)
			return
		}
		if (candidate.timer === null) {
			candidate.timer = win.setTimeout(() => record(el, candidate), ITEM_SEEN_MS)
		}
	}

	const tallVisible = (el: Element): boolean => {
		const height = viewportHeight()
		const rect = el.getBoundingClientRect()
		const shown = Math.min(rect.bottom, height) - Math.max(rect.top, 0)
		return height > 0 && shown >= height * ITEM_VISIBLE_SHARE
	}

	const onIntersect = (entries: IntersectionObserverEntry[]) => {
		for (const entry of entries) {
			const candidate = candidates.get(entry.target)
			if (!candidate) {
				continue
			}
			const rootHeight = entry.rootBounds?.height ?? viewportHeight()
			candidate.tall = entry.isIntersecting && entry.boundingClientRect.height > rootHeight
			candidate.visible =
				entry.isIntersecting &&
				(entry.intersectionRatio >= ITEM_VISIBLE_SHARE ||
					(candidate.tall && entry.intersectionRect.height >= rootHeight * ITEM_VISIBLE_SHARE))
			clock(entry.target, candidate)
		}
	}

	const recheckTall = () => {
		frame = null
		for (const [el, candidate] of candidates) {
			if (candidate.tall) {
				candidate.visible = tallVisible(el)
				clock(el, candidate)
			}
		}
	}

	const anyTall = (): boolean => {
		for (const candidate of candidates.values()) {
			if (candidate.tall) {
				return true
			}
		}
		return false
	}

	/** Thresholds never fire while an item taller than the screen scrolls through it. */
	const onScroll = () => {
		if (frame !== null || !anyTall()) {
			return
		}
		if (typeof win.requestAnimationFrame === 'function') {
			frame = win.requestAnimationFrame(recheckTall)
			return
		}
		recheckTall()
	}

	const forget = (el: Element) => {
		const candidate = candidates.get(el)
		if (candidate) {
			clearClock(candidate)
		}
		candidates.delete(el)
		intersections?.unobserve(el)
	}

	/** Hiding the tab breaks every clock; coming back starts the ones still visible again. */
	const onVisibilityChange = () => {
		for (const [el, candidate] of candidates) {
			clock(el, candidate)
		}
	}

	/** The measuring, set up once the page holds an item to measure. */
	const observe = (): IntersectionObserver => {
		if (intersections === null) {
			intersections = new win.IntersectionObserver(onIntersect, { threshold: THRESHOLDS })
			doc.addEventListener('visibilitychange', onVisibilityChange)
			win.addEventListener('scroll', onScroll, { passive: true })
			win.addEventListener('resize', onScroll, { passive: true })
		}
		return intersections
	}

	/** Takes the measuring down while the page holds no item. */
	const unobserve = () => {
		intersections?.disconnect()
		intersections = null
		if (frame !== null) {
			win.cancelAnimationFrame?.(frame)
			frame = null
		}
		doc.removeEventListener('visibilitychange', onVisibilityChange)
		win.removeEventListener('scroll', onScroll)
		win.removeEventListener('resize', onScroll)
	}

	const watch = (el: Element, ref: string) => {
		candidates.set(el, { ref, visible: false, tall: false, timer: null })
		observe().observe(el)
	}

	/**
	 * Observes new items, forgets removed ones, and treats an element whose ref changed as new. A
	 * page left with no item measures nothing at all.
	 */
	const rescan = () => {
		rescanHandle = null
		if (!running) {
			return
		}
		for (const el of [...candidates.keys()]) {
			if (!el.isConnected) {
				forget(el)
			}
		}
		for (const el of Array.from(doc.querySelectorAll(`[${ITEM_ATTRIBUTE}]`))) {
			const ref = el.getAttribute(ITEM_ATTRIBUTE)
			const known = candidates.get(el)
			if (ref === null || parseItemValue(ref) === null) {
				if (known) {
					forget(el)
				}
				continue
			}
			if (known?.ref === ref) {
				continue
			}
			if (known) {
				forget(el)
			}
			watch(el, ref)
		}
		if (candidates.size === 0) {
			unobserve()
		}
	}

	const cancelRescan = () => {
		if (rescanHandle === null) {
			return
		}
		if ('idle' in rescanHandle) {
			win.cancelIdleCallback(rescanHandle.idle)
		} else {
			win.clearTimeout(rescanHandle.timeout)
		}
		rescanHandle = null
	}

	const scheduleRescan = () => {
		if (rescanHandle !== null) {
			return
		}
		rescanHandle =
			typeof win.requestIdleCallback === 'function'
				? { idle: win.requestIdleCallback(rescan, { timeout: RESCAN_TIMEOUT_MS }) }
				: { timeout: win.setTimeout(rescan, RESCAN_FALLBACK_MS) }
	}

	const stop = () => {
		running = false
		unobserve()
		mutations?.disconnect()
		mutations = null
		cancelRescan()
		for (const candidate of candidates.values()) {
			clearClock(candidate)
		}
		candidates.clear()
		for (const ref of pending) {
			seen.delete(ref)
		}
		pending = []
	}

	return {
		start() {
			if (running || typeof win.IntersectionObserver !== 'function') {
				return
			}
			running = true
			if (typeof win.MutationObserver === 'function' && doc.documentElement) {
				mutations = new win.MutationObserver(scheduleRescan)
				mutations.observe(doc.documentElement, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: [ITEM_ATTRIBUTE],
				})
			}
			rescan()
		},
		stop,
		resetPage() {
			seen.clear()
			pending = []
			if (!running) {
				return
			}
			// Observing again hands every element a fresh first callback, so an item still on
			// screen after the navigation starts its clock for the new pageview.
			for (const [el, candidate] of [...candidates]) {
				forget(el)
				watch(el, candidate.ref)
			}
			scheduleRescan()
		},
		take() {
			const taken = pending
			pending = []
			return taken
		},
		destroy() {
			stop()
			seen.clear()
		},
	}
}
