import {
	CURRENCY_ATTRIBUTE,
	DOWNLOAD_EVENT,
	EVENT_ATTRIBUTE,
	EVENT_PROP_PREFIX,
	GOAL_ATTRIBUTE,
	ITEM_ATTRIBUTE,
	ITEM_CLICK_EVENT,
	ITEM_NAME_ATTRIBUTE,
	OUTBOUND_EVENT,
	SCROLL_EVENT,
	VALUE_ATTRIBUTE,
} from '../goals/constants'
import { parseItemValue } from '../items/ref'
import { DEFAULT_ITEM_CAPTURE, type ResolvedAutoCapture, type ResolvedItemCapture } from './config'
import type { TrackerWindow } from './types'

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

/**
 * How long a new page has to render before its first screen counts toward its depth: by then a
 * router has swapped the layout in and reset the scroll position.
 */
const FIRST_SCREEN_MS = 1000

/** The item an auto-captured event happened inside, and the name vendor slots get with it. */
export interface CapturedItem {
	item: string
	itemName?: string
}

export interface AutoCaptureHandlers {
	track(name: string, props?: Record<string, unknown>, item?: CapturedItem): void
	trackGoal(
		slug: string,
		opts?: { value?: number; currency?: string; item?: string; itemName?: string }
	): void
}

/**
 * The item settings, with a config snapshot rendered before items existed keeping the documented
 * default rather than losing them.
 */
export const itemCaptureOf = (options: ResolvedAutoCapture): ResolvedItemCapture =>
	options.items ?? DEFAULT_ITEM_CAPTURE

export interface AutoCapture {
	/**
	 * Deepest scroll the current page reached, as measured while it was the page on screen, or
	 * undefined when the toggle is off. Never read off the layout when asked.
	 */
	scrollDepth(): number | undefined
	/** Clears the per-page state (scroll depth, thresholds, items clicked) after a navigation. */
	resetPage(): void
	destroy(): void
}

const linkFor = (target: EventTarget | null): HTMLAnchorElement | null =>
	target instanceof Element ? target.closest('a[href]') : null

/**
 * Scheme, host and path only: signed download links, reset tokens and session ids travel in the
 * query, the fragment and the credentials.
 */
const destinationOf = (url: URL): string => `${url.origin}${url.pathname}`

const isDownload = (url: URL): boolean => {
	const extension = url.pathname.split('.').pop()?.toLowerCase()
	return extension !== undefined && DOWNLOAD_EXTENSIONS.has(extension)
}

const goalPayload = (el: Element): { value?: number; currency?: string } => {
	// Blank is absent, not zero: `Number('')` is 0, and an unfilled template slot must not
	// book a zero-revenue conversion.
	const raw = el.getAttribute(VALUE_ATTRIBUTE)?.trim()
	const value = raw ? Number(raw) : Number.NaN
	const currency = el.getAttribute(CURRENCY_ATTRIBUTE)
	return {
		...(Number.isFinite(value) ? { value } : {}),
		...(currency ? { currency } : {}),
	}
}

const MAX_EVENT_PROPS = 20
const MAX_EVENT_PROP_LENGTH = 256

/** The item an element sits in, from the nearest ancestor marked as one with a usable ref. */
const capturedItem = (target: Element): CapturedItem | undefined => {
	const el = target.closest(`[${ITEM_ATTRIBUTE}]`)
	const ref = el?.getAttribute(ITEM_ATTRIBUTE)
	if (!el || !ref || parseItemValue(ref) === null) {
		return undefined
	}
	const name = el.getAttribute(ITEM_NAME_ATTRIBUTE)?.trim().slice(0, MAX_EVENT_PROP_LENGTH)
	return { item: ref, ...(name ? { itemName: name } : {}) }
}

/** `data-analytics-prop-plan="pro"` on the tagged element becomes `{ plan: 'pro' }`. */
const eventProps = (el: Element): Record<string, string> | undefined => {
	const out: Record<string, string> = {}
	let kept = 0
	for (const attr of Array.from(el.attributes)) {
		if (kept >= MAX_EVENT_PROPS || !attr.name.startsWith(EVENT_PROP_PREFIX)) {
			continue
		}
		const key = attr.name.slice(EVENT_PROP_PREFIX.length)
		if (key === '') {
			continue
		}
		out[key] = attr.value.slice(0, MAX_EVENT_PROP_LENGTH)
		kept++
	}
	return kept > 0 ? out : undefined
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
 * The delegated listeners behind `capture.autoCapture`, bound once on `document` in the capture
 * phase so a handler that stops propagation, or a link that navigates away, cannot swallow one.
 */
export const createAutoCapture = (args: {
	win: TrackerWindow
	options: ResolvedAutoCapture
	handlers: AutoCaptureHandlers
}): AutoCapture => {
	const { win, options, handlers } = args
	const doc = win.document
	const items = itemCaptureOf(options)
	const credits = items.impressions || items.clicks || items.pages
	let maxDepth = 0
	let fired = new Set<number>()
	let clicked = new Set<string>()
	let frame: number | null = null
	let cancelFirstScreen: (() => void) | null = null

	const onItemClick = (target: EventTarget | null) => {
		if (!(target instanceof Element)) {
			return
		}
		const captured = capturedItem(target)
		if (captured && !clicked.has(captured.item)) {
			clicked.add(captured.item)
			handlers.track(ITEM_CLICK_EVENT, undefined, captured)
		}
	}

	const onClick = (event: Event) => {
		if (items.clicks) {
			onItemClick(event.target)
		}
		const link = linkFor(event.target)
		if (link) {
			let url: URL | null = null
			try {
				url = new URL(link.href, win.location.href)
			} catch {
				url = null
			}
			if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
				const destination = destinationOf(url)
				// A link both outbound and a download reports both, as the vendors' own extensions do.
				if (options.outboundLinks && url.origin !== win.location.origin) {
					handlers.track(OUTBOUND_EVENT, { url: destination })
				}
				if (options.fileDownloads && isDownload(url)) {
					handlers.track(DOWNLOAD_EVENT, { url: destination })
				}
			}
		}
		if (!options.goalAttribute) {
			return
		}
		fireTagged(event.target, 'click')
	}

	const onSubmit = (event: Event) => {
		fireTagged(event.target, 'submit')
	}

	/**
	 * Each attribute is read from its nearest tagged ancestor, so a card or form can be tagged at its
	 * root. A tagged form answers only its own submit; goal and event are looked up independently.
	 */
	const fireTagged = (target: EventTarget | null, trigger: 'click' | 'submit') => {
		if (!(target instanceof Element)) {
			return
		}
		const answers = (el: Element | null): el is Element =>
			el !== null && (trigger === 'submit' ? el === target : el.localName !== 'form')
		const captured = credits ? capturedItem(target) : undefined
		const goalEl = target.closest(`[${GOAL_ATTRIBUTE}]`)
		const slug = goalEl?.getAttribute(GOAL_ATTRIBUTE)
		if (answers(goalEl) && slug) {
			handlers.trackGoal(slug, { ...goalPayload(goalEl), ...captured })
		}
		const eventEl = target.closest(`[${EVENT_ATTRIBUTE}]`)
		const name = eventEl?.getAttribute(EVENT_ATTRIBUTE)
		if (answers(eventEl) && name) {
			if (captured) {
				handlers.track(name, eventProps(eventEl), captured)
			} else {
				handlers.track(name, eventProps(eventEl))
			}
		}
	}

	/** A layout read in a document being torn down can throw; that moment measures nothing. */
	const measure = (): number | undefined => {
		let depth: number
		try {
			depth = currentDepth(win)
		} catch {
			return undefined
		}
		maxDepth = Math.max(maxDepth, depth)
		return depth
	}

	const onScrollFrame = () => {
		frame = null
		const depth = measure()
		if (depth === undefined) {
			return
		}
		for (const threshold of SCROLL_THRESHOLDS) {
			if (depth >= threshold && !fired.has(threshold)) {
				fired.add(threshold)
				handlers.track(SCROLL_EVENT, { depth: threshold })
			}
		}
	}

	const onScroll = () => {
		frame ??= win.requestAnimationFrame(onScrollFrame)
	}

	const cancelPending = () => {
		if (frame !== null) {
			win.cancelAnimationFrame(frame)
			frame = null
		}
		cancelFirstScreen?.()
		cancelFirstScreen = null
	}

	const measureFirstScreen = () => {
		const timer = win.setTimeout(() => {
			cancelFirstScreen = null
			measure()
		}, FIRST_SCREEN_MS)
		cancelFirstScreen = () => win.clearTimeout(timer)
	}

	const clickBound =
		options.outboundLinks || options.fileDownloads || options.goalAttribute || items.clicks
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
		scrollDepth: () => (options.scrollDepth ? maxDepth : undefined),
		resetPage() {
			cancelPending()
			maxDepth = 0
			fired = new Set<number>()
			clicked = new Set<string>()
			if (options.scrollDepth) {
				measureFirstScreen()
			}
		},
		destroy() {
			cancelPending()
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
