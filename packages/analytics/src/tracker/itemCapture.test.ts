import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ITEM_ATTRIBUTE, MAX_ITEMS_PER_BEACON } from '../goals/constants'
import { createItemCapture, ITEM_SEEN_MS, type ItemCapture } from './itemCapture'

interface Geometry {
	/** The element's own height; the screen is 800 tall. */
	height?: number
	/** How much of it is on screen, in pixels; defaults to its height times the ratio. */
	shown?: number
}

const SCREEN = 800

/** Stands in for the browser's observer: the test says what is on screen, and when. */
class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = []
	readonly observed = new Set<Element>()
	readonly root = null
	readonly rootMargin = ''
	readonly thresholds: number[]

	constructor(
		readonly callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit
	) {
		const threshold = options?.threshold ?? 0
		this.thresholds = Array.isArray(threshold) ? threshold : [threshold]
		FakeIntersectionObserver.instances.push(this)
	}

	observe(el: Element) {
		this.observed.add(el)
	}

	unobserve(el: Element) {
		this.observed.delete(el)
	}

	disconnect() {
		this.observed.clear()
	}

	takeRecords(): IntersectionObserverEntry[] {
		return []
	}

	report(el: Element, ratio: number, geometry: Geometry = {}) {
		const height = geometry.height ?? 100
		const entry = {
			target: el,
			isIntersecting: ratio > 0,
			intersectionRatio: ratio,
			boundingClientRect: { height },
			intersectionRect: { height: geometry.shown ?? height * ratio },
			rootBounds: { height: SCREEN },
			time: 0,
		} as unknown as IntersectionObserverEntry
		this.callback([entry], this as unknown as IntersectionObserver)
	}
}

const observer = (): FakeIntersectionObserver => {
	const latest = FakeIntersectionObserver.instances.at(-1)
	if (!latest) {
		throw new Error('no observer was created')
	}
	return latest
}

const item = (ref: string): HTMLElement => {
	const el = document.createElement('div')
	el.setAttribute(ITEM_ATTRIBUTE, ref)
	document.body.append(el)
	return el
}

const setVisibility = (state: DocumentVisibilityState) => {
	Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
	document.dispatchEvent(new Event('visibilitychange'))
}

/** Lets a MutationObserver deliver, then waits out the idle rescan it scheduled. */
const settle = async () => {
	await Promise.resolve()
	vi.advanceTimersByTime(1000)
}

let capture: ItemCapture
let full: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
	vi.useFakeTimers()
	FakeIntersectionObserver.instances = []
	vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
	full = vi.fn<() => void>()
	capture = createItemCapture({ win: window, onFull: full })
})

afterEach(() => {
	capture.destroy()
	document.body.replaceChildren()
	Reflect.deleteProperty(document, 'visibilityState')
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('what counts as seen', () => {
	it('counts an item at least half on screen for a whole second', () => {
		const el = item('offers:1')
		capture.start()
		expect(observer().thresholds).toEqual([0, 0.5, 1])
		observer().report(el, 0.6)
		vi.advanceTimersByTime(ITEM_SEEN_MS - 1)
		expect(capture.take()).toEqual([])
		vi.advanceTimersByTime(1)
		expect(capture.take()).toEqual(['offers:1'])
	})

	it('starts the second over when the item drops below half before it is up', () => {
		const el = item('offers:1')
		capture.start()
		observer().report(el, 0.6)
		vi.advanceTimersByTime(600)
		observer().report(el, 0.3)
		vi.advanceTimersByTime(600)
		expect(capture.take()).toEqual([])
		observer().report(el, 0.6)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1'])
	})

	it('counts an item taller than the screen once it fills half of the screen', () => {
		const tall = item('offers:tall')
		const short = item('offers:short')
		capture.start()
		observer().report(tall, 0.3, { height: 2000, shown: 600 })
		observer().report(short, 0.1, { height: 2000, shown: 200 })
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:tall'])
	})

	it('counts nothing while the tab is in the background, and starts again in front', () => {
		const el = item('offers:1')
		capture.start()
		setVisibility('hidden')
		observer().report(el, 1)
		vi.advanceTimersByTime(5000)
		expect(capture.take()).toEqual([])
		setVisibility('visible')
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1'])
	})

	it('breaks the second when the tab goes to the background in the middle of it', () => {
		const el = item('offers:1')
		capture.start()
		observer().report(el, 1)
		vi.advanceTimersByTime(600)
		setVisibility('hidden')
		setVisibility('visible')
		vi.advanceTimersByTime(600)
		expect(capture.take()).toEqual([])
		vi.advanceTimersByTime(400)
		expect(capture.take()).toEqual(['offers:1'])
	})

	it('drops an item its styles hide at the moment it would count', () => {
		const el = item('offers:1')
		Object.defineProperty(el, 'checkVisibility', { value: () => false })
		capture.start()
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual([])
	})

	it('watches nothing marked with a ref ingest would refuse, and measures nothing for it', () => {
		item('offers')
		item('offers:a b')
		capture.start()
		expect(FakeIntersectionObserver.instances).toHaveLength(0)
	})
})

describe('a page without items', () => {
	it('creates no intersection observer and adds no listener until an item appears', async () => {
		const added = vi.spyOn(window, 'addEventListener')
		capture.start()
		expect(FakeIntersectionObserver.instances).toHaveLength(0)
		expect(added).not.toHaveBeenCalled()
		const el = item('offers:1')
		await settle()
		expect(observer().observed.has(el)).toBe(true)
		expect(added.mock.calls.map(([type]) => type)).toEqual(['scroll', 'resize'])
		added.mockRestore()
	})

	it('takes the measuring down once the last item leaves the page', async () => {
		const el = item('offers:1')
		const removed = vi.spyOn(window, 'removeEventListener')
		capture.start()
		const measuring = observer()
		el.remove()
		await settle()
		expect(measuring.observed.size).toBe(0)
		expect(removed.mock.calls.map(([type]) => type)).toEqual(['scroll', 'resize'])
		removed.mockRestore()
	})
})

describe('once per pageview', () => {
	it('counts an item once, however often it comes back into view', () => {
		const el = item('offers:1')
		capture.start()
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		observer().report(el, 0)
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1'])
	})

	it('counts two elements showing one item as one view of it', () => {
		const first = item('offers:1')
		const second = item('offers:1')
		capture.start()
		observer().report(first, 1)
		observer().report(second, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1'])
	})

	it('counts the item again on the next pageview', () => {
		const el = item('offers:1')
		capture.start()
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1'])
		capture.resetPage()
		expect(observer().observed.has(el)).toBe(true)
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1'])
	})
})

describe('a page that changes', () => {
	it('watches an item added later, once the page has had a quiet moment', async () => {
		item('offers:early')
		capture.start()
		const el = item('offers:late')
		expect(observer().observed.has(el)).toBe(false)
		await settle()
		expect(observer().observed.has(el)).toBe(true)
	})

	it('treats an element whose ref changed as a new item', async () => {
		const el = item('offers:1')
		capture.start()
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		el.setAttribute(ITEM_ATTRIBUTE, 'offers:2')
		await settle()
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1', 'offers:2'])
	})

	it('forgets an element taken out of the page', async () => {
		const el = item('offers:1')
		capture.start()
		el.remove()
		await settle()
		expect(observer().observed.has(el)).toBe(false)
	})
})

describe('lifecycle', () => {
	it('asks for an early message once one would be full', () => {
		const els = Array.from({ length: MAX_ITEMS_PER_BEACON }, (_, i) => item(`offers:${i}`))
		capture.start()
		for (const el of els) {
			observer().report(el, 1)
		}
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(full).toHaveBeenCalledOnce()
		expect(capture.take()).toHaveLength(MAX_ITEMS_PER_BEACON)
	})

	it('drops what was seen and not sent when it stops, so the item may count again', () => {
		const el = item('offers:1')
		capture.start()
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		capture.stop()
		expect(capture.take()).toEqual([])
		capture.start()
		observer().report(el, 1)
		vi.advanceTimersByTime(ITEM_SEEN_MS)
		expect(capture.take()).toEqual(['offers:1'])
	})

	it('reports nothing at all in a browser without IntersectionObserver', () => {
		vi.unstubAllGlobals()
		Reflect.deleteProperty(window, 'IntersectionObserver')
		item('offers:1')
		const bare = createItemCapture({ win: window, onFull: full })
		bare.start()
		vi.advanceTimersByTime(5000)
		expect(bare.take()).toEqual([])
		bare.destroy()
	})
})
