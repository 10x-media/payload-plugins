import type { ResolvedAutoCapture } from '../core/options'
import type { TrackerWindow } from './types'

/** Event name for a click on a link leaving the site. */
export const OUTBOUND_EVENT = 'outbound_link'
/** Event name for a click on a link whose target is a file. */
export const DOWNLOAD_EVENT = 'file_download'
/** Event name for a crossed scroll threshold; `props.depth` carries which one. */
export const SCROLL_EVENT = 'scroll_depth'

export const GOAL_ATTRIBUTE = 'data-analytics-goal'
const VALUE_ATTRIBUTE = 'data-analytics-value'
const CURRENCY_ATTRIBUTE = 'data-analytics-currency'

const DOWNLOAD_EXTENSIONS = new Set([
	'pdf',
	'zip',
	'csv',
	'xlsx',
	'xls',
	'docx',
	'doc',
	'pptx',
	'mp3',
	'mp4',
	'dmg',
	'exe',
	'apk',
	'rar',
	'7z',
	'txt',
])

const SCROLL_THRESHOLDS = [25, 50, 75, 100] as const

export interface AutoCaptureHandlers {
	track(name: string, props?: Record<string, unknown>): void
	trackGoal(slug: string, opts?: { value?: number; currency?: string }): void
}

export interface AutoCapture {
	/** Deepest scroll reached on the current page, or undefined when the toggle is off. */
	scrollDepth(): number | undefined
	/** Clears the per-page state (scroll thresholds) after a navigation. */
	resetPage(): void
	destroy(): void
}

const linkFor = (target: EventTarget | null): HTMLAnchorElement | null =>
	target instanceof Element ? target.closest('a[href]') : null

const isDownload = (url: URL): boolean => {
	const extension = url.pathname.split('.').pop()?.toLowerCase()
	return Boolean(extension) && DOWNLOAD_EXTENSIONS.has(extension as string)
}

const goalPayload = (el: Element): { value?: number; currency?: string } => {
	const raw = el.getAttribute(VALUE_ATTRIBUTE)
	const value = raw === null ? Number.NaN : Number(raw)
	const currency = el.getAttribute(CURRENCY_ATTRIBUTE)
	return {
		...(Number.isFinite(value) ? { value } : {}),
		...(currency ? { currency } : {}),
	}
}

const currentDepth = (win: TrackerWindow): number => {
	const doc = win.document.documentElement
	const height = Math.max(doc?.scrollHeight ?? 0, win.document.body?.scrollHeight ?? 0)
	if (height <= 0) {
		return 0
	}
	const viewed = (win.scrollY ?? 0) + (win.innerHeight ?? 0)
	return Math.max(0, Math.min(100, Math.round((viewed / height) * 100)))
}

/**
 * The delegated listeners behind `capture.autoCapture`. Everything is bound once on
 * `document` in the capture phase, so a handler that stops propagation (or a link that
 * navigates away) cannot swallow the event first, and the listener set never grows with
 * the DOM.
 *
 * A link that is both outbound and a download reports both, matching how the vendors
 * ship those as two independent extensions; turning one toggle off never changes what
 * the other counts.
 *
 * Scroll thresholds are evaluated on scroll only, never on load or on a route change, so
 * a fresh page whose DOM has not rendered yet cannot inherit the previous page's depth.
 * The max fed into the pageview still folds in the position at read time, so a page too
 * short to scroll still reports its depth.
 */
export const createAutoCapture = (args: {
	win: TrackerWindow
	options: ResolvedAutoCapture
	handlers: AutoCaptureHandlers
}): AutoCapture => {
	const { win, options, handlers } = args
	const doc = win.document
	let maxDepth = 0
	let fired = new Set<number>()

	const onClick = (event: Event) => {
		const link = linkFor(event.target)
		if (link) {
			let url: URL | null = null
			try {
				url = new URL(link.href, win.location.href)
			} catch {
				url = null
			}
			if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
				if (options.outboundLinks && url.origin !== win.location.origin) {
					handlers.track(OUTBOUND_EVENT, { url: url.href })
				}
				if (options.fileDownloads && isDownload(url)) {
					handlers.track(DOWNLOAD_EVENT, { url: url.href })
				}
			}
		}
		if (!options.goalAttribute) {
			return
		}
		const goalEl =
			event.target instanceof Element ? event.target.closest(`[${GOAL_ATTRIBUTE}]`) : null
		const slug = goalEl?.getAttribute(GOAL_ATTRIBUTE)
		if (goalEl && slug) {
			handlers.trackGoal(slug, goalPayload(goalEl))
		}
	}

	const onSubmit = (event: Event) => {
		const form =
			event.target instanceof Element ? event.target.closest(`[${GOAL_ATTRIBUTE}]`) : null
		const slug = form?.getAttribute(GOAL_ATTRIBUTE)
		if (form && slug) {
			handlers.trackGoal(slug, goalPayload(form))
		}
	}

	const onScroll = () => {
		const depth = currentDepth(win)
		if (depth <= maxDepth) {
			return
		}
		maxDepth = depth
		for (const threshold of SCROLL_THRESHOLDS) {
			if (depth >= threshold && !fired.has(threshold)) {
				fired.add(threshold)
				handlers.track(SCROLL_EVENT, { depth: threshold })
			}
		}
	}

	const clickBound = options.outboundLinks || options.fileDownloads || options.goalAttribute
	if (clickBound) {
		doc.addEventListener('click', onClick, true)
	}
	if (options.goalAttribute) {
		doc.addEventListener('submit', onSubmit, true)
	}
	if (options.scrollDepth) {
		win.addEventListener('scroll', onScroll, { passive: true })
	}

	return {
		scrollDepth: () => (options.scrollDepth ? Math.max(maxDepth, currentDepth(win)) : undefined),
		resetPage() {
			maxDepth = 0
			fired = new Set<number>()
		},
		destroy() {
			if (clickBound) {
				doc.removeEventListener('click', onClick, true)
			}
			if (options.goalAttribute) {
				doc.removeEventListener('submit', onSubmit, true)
			}
			if (options.scrollDepth) {
				win.removeEventListener('scroll', onScroll)
			}
		},
	}
}
