import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AutoCapture, type AutoCaptureHandlers, createAutoCapture } from './autoCapture'
import type { ResolvedAutoCapture } from './config'

const ALL_ON: ResolvedAutoCapture = {
	scrollDepth: true,
	outboundLinks: true,
	fileDownloads: true,
	goalAttribute: true,
	query: true,
	items: { impressions: true, clicks: true, pages: true },
}

let handlers: AutoCaptureHandlers & {
	track: ReturnType<typeof vi.fn>
	trackGoal: ReturnType<typeof vi.fn>
}
let capture: AutoCapture | null = null

const swallowNavigation = (event: Event) => event.preventDefault()

const start = (options: Partial<ResolvedAutoCapture> = {}) => {
	capture = createAutoCapture({
		win: window,
		options: { ...ALL_ON, ...options },
		handlers,
	})
	return capture
}

const clickOn = (el: Element) => {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** Lays the page out as given, the way a render or a route change does: no scroll event. */
const layOut = (args: { scrollY: number; innerHeight: number; scrollHeight: number }) => {
	Object.defineProperty(window, 'scrollY', { value: args.scrollY, configurable: true })
	Object.defineProperty(window, 'innerHeight', { value: args.innerHeight, configurable: true })
	Object.defineProperty(document.documentElement, 'scrollHeight', {
		value: args.scrollHeight,
		configurable: true,
	})
}

/** Scrolls to the given position, then lets the animation frame that measures it run. */
const setScroll = (args: { scrollY: number; innerHeight: number; scrollHeight: number }) => {
	layOut(args)
	window.dispatchEvent(new Event('scroll'))
	vi.advanceTimersByTime(FRAME_MS)
}

const FRAME_MS = 16

beforeEach(() => {
	vi.useFakeTimers()
	handlers = {
		track: vi.fn((_name: string, _props?: Record<string, unknown>) => undefined),
		trackGoal: vi.fn((_slug: string, _opts?: { value?: number; currency?: string }) => undefined),
	}
	document.body.innerHTML = ''
	document.addEventListener('click', swallowNavigation)
})

afterEach(() => {
	capture?.destroy()
	capture = null
	document.removeEventListener('click', swallowNavigation)
	layOut({ scrollY: 0, innerHeight: 768, scrollHeight: 0 })
	vi.useRealTimers()
})

describe('outbound links', () => {
	it('reports a click on another origin', () => {
		start()
		document.body.innerHTML = '<a href="https://example.com/pricing">go</a>'
		clickOn(document.querySelector('a') as HTMLAnchorElement)

		expect(handlers.track).toHaveBeenCalledWith('outbound_link', {
			url: 'https://example.com/pricing',
		})
	})

	it('reports a click on a child of the link', () => {
		start()
		document.body.innerHTML = '<a href="https://example.com/"><span id="inner">go</span></a>'
		clickOn(document.getElementById('inner') as HTMLElement)

		expect(handlers.track).toHaveBeenCalledWith('outbound_link', { url: 'https://example.com/' })
	})

	it('ignores same-origin and non-http links', () => {
		start()
		document.body.innerHTML =
			'<a id="a" href="/pricing">internal</a><a id="b" href="mailto:hi@example.com">mail</a><a id="c" href="#top">anchor</a>'
		for (const id of ['a', 'b', 'c']) {
			clickOn(document.getElementById(id) as HTMLElement)
		}

		expect(handlers.track).not.toHaveBeenCalled()
	})

	it('stays silent when the toggle is off', () => {
		start({ outboundLinks: false })
		document.body.innerHTML = '<a href="https://example.com/">go</a>'
		clickOn(document.querySelector('a') as HTMLAnchorElement)

		expect(handlers.track).not.toHaveBeenCalled()
	})
})

describe('file downloads', () => {
	it('reports a click on a known extension, same origin or not', () => {
		start({ outboundLinks: false })
		document.body.innerHTML =
			'<a id="a" href="/files/report.pdf">local</a><a id="b" href="https://cdn.example.com/a.ZIP?v=2">remote</a>'
		clickOn(document.getElementById('a') as HTMLElement)
		clickOn(document.getElementById('b') as HTMLElement)

		expect(handlers.track).toHaveBeenNthCalledWith(1, 'file_download', {
			url: 'http://localhost:3000/files/report.pdf',
		})
		expect(handlers.track).toHaveBeenNthCalledWith(2, 'file_download', {
			url: 'https://cdn.example.com/a.ZIP',
		})
	})

	// Signed download links and reset tokens travel in the query and the fragment.
	it('records where a link leads without its query, fragment or credentials', () => {
		start({})
		document.body.innerHTML =
			'<a id="a" href="https://user:pw@files.example.com/q/report.pdf?token=s3cr3t#page=2">file</a>'
		clickOn(document.getElementById('a') as HTMLElement)

		expect(handlers.track).toHaveBeenNthCalledWith(1, 'outbound_link', {
			url: 'https://files.example.com/q/report.pdf',
		})
		expect(handlers.track).toHaveBeenNthCalledWith(2, 'file_download', {
			url: 'https://files.example.com/q/report.pdf',
		})
		expect(JSON.stringify(handlers.track.mock.calls)).not.toContain('s3cr3t')
	})

	it('ignores an unlisted extension', () => {
		start({ outboundLinks: false })
		document.body.innerHTML = '<a href="/files/page.html">page</a>'
		clickOn(document.querySelector('a') as HTMLAnchorElement)

		expect(handlers.track).not.toHaveBeenCalled()
	})

	it('stays silent when the toggle is off', () => {
		start({ fileDownloads: false, outboundLinks: false })
		document.body.innerHTML = '<a href="/files/report.pdf">local</a>'
		clickOn(document.querySelector('a') as HTMLAnchorElement)

		expect(handlers.track).not.toHaveBeenCalled()
	})
})

describe('goal attribute', () => {
	it('reports a click on the closest annotated ancestor, with value and currency', () => {
		start()
		document.body.innerHTML =
			'<div data-analytics-goal="signup" data-analytics-value="49.5" data-analytics-currency="EUR"><button id="btn">go</button></div>'
		clickOn(document.getElementById('btn') as HTMLElement)

		expect(handlers.trackGoal).toHaveBeenCalledWith('signup', { value: 49.5, currency: 'EUR' })
	})

	it('omits a non-numeric value', () => {
		start()
		document.body.innerHTML =
			'<button data-analytics-goal="signup" data-analytics-value="free">go</button>'
		clickOn(document.querySelector('button') as HTMLElement)

		expect(handlers.trackGoal).toHaveBeenCalledWith('signup', {})
	})

	it('treats a blank value as absent rather than zero', () => {
		start()
		document.body.innerHTML =
			'<button id="a" data-analytics-goal="signup" data-analytics-value="">a</button><button id="b" data-analytics-goal="signup" data-analytics-value="  ">b</button>'
		clickOn(document.getElementById('a') as HTMLElement)
		clickOn(document.getElementById('b') as HTMLElement)

		expect(handlers.trackGoal).toHaveBeenNthCalledWith(1, 'signup', {})
		expect(handlers.trackGoal).toHaveBeenNthCalledWith(2, 'signup', {})
	})

	it('reports a form submit', () => {
		start()
		document.body.innerHTML =
			'<form data-analytics-goal="contact" data-analytics-value="10"><input name="a" /></form>'
		const form = document.querySelector('form') as HTMLFormElement
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

		expect(handlers.trackGoal).toHaveBeenCalledWith('contact', { value: 10 })
	})

	describe('on a form', () => {
		// `click()` runs the element's activation, as a visitor's click does: a submit button submits.
		// The page's own handler then keeps the page, as a single-page app's form does.
		const keepPage = (event: Event) => event.preventDefault()
		const submits: Event[] = []
		const press = (selector: string) => (document.querySelector(selector) as HTMLElement).click()
		const countSubmit = (event: Event) => submits.push(event)

		beforeEach(() => {
			submits.length = 0
			// No link here to keep from navigating, and a cancelled click would submit nothing.
			document.removeEventListener('click', swallowNavigation)
			document.addEventListener('submit', keepPage)
			document.addEventListener('submit', countSubmit)
		})

		afterEach(() => {
			document.removeEventListener('submit', keepPage)
			document.removeEventListener('submit', countSubmit)
		})

		it('completes nothing on a click inside it that submits nothing', () => {
			start()
			document.body.innerHTML =
				'<form data-analytics-goal="newsletter-signup"><label for="email">Email</label><input id="email" name="email" /><button type="button">Show terms</button></form>'
			press('label')
			press('input')
			press('button')
			press('form')

			expect(submits).toHaveLength(0)
			expect(handlers.trackGoal).not.toHaveBeenCalled()
		})

		it('completes once per submission, the submit button click that sent it included', () => {
			start()
			document.body.innerHTML =
				'<form data-analytics-goal="newsletter-signup"><input name="email" /><button type="submit">Subscribe</button></form>'
			press('button')
			;(document.querySelector('form') as HTMLFormElement).requestSubmit()

			expect(submits).toHaveLength(2)
			expect(handlers.trackGoal.mock.calls).toEqual([
				['newsletter-signup', {}],
				['newsletter-signup', {}],
			])
		})

		it('fires a custom event on the form once per submission too', () => {
			start()
			document.body.innerHTML =
				'<form data-analytics-event="signup"><input name="email" /><button type="submit">Go</button></form>'
			press('input')
			press('button')

			expect(submits).toHaveLength(1)
			expect(handlers.track.mock.calls).toEqual([['signup', undefined]])
		})

		it('leaves a tagged button inside it completing on click, and the form on submit', () => {
			start()
			document.body.innerHTML =
				'<form data-analytics-goal="newsletter-signup"><button data-analytics-goal="cta" type="submit">Subscribe</button></form>'
			press('button')

			expect(handlers.trackGoal.mock.calls).toEqual([
				['cta', {}],
				['newsletter-signup', {}],
			])
		})

		it('leaves a tagged element around a form to its click, so a submission counts it once', () => {
			start()
			document.body.innerHTML =
				'<div data-analytics-goal="card"><form><button type="submit">Send</button></form></div>'
			press('button')

			expect(submits).toHaveLength(1)
			expect(handlers.trackGoal.mock.calls).toEqual([['card', {}]])
		})
	})

	it('stays silent when the toggle is off', () => {
		start({ goalAttribute: false })
		document.body.innerHTML = '<button data-analytics-goal="signup">go</button>'
		clickOn(document.querySelector('button') as HTMLElement)

		expect(handlers.trackGoal).not.toHaveBeenCalled()
	})
})

describe('scroll depth', () => {
	it('fires each threshold once and remembers the deepest position', () => {
		const tracking = start()
		setScroll({ scrollY: 0, innerHeight: 300, scrollHeight: 1000 })
		expect(handlers.track).toHaveBeenCalledWith('scroll_depth', { depth: 25 })
		expect(handlers.track).toHaveBeenCalledTimes(1)

		setScroll({ scrollY: 500, innerHeight: 300, scrollHeight: 1000 })
		expect(handlers.track).toHaveBeenNthCalledWith(2, 'scroll_depth', { depth: 50 })
		expect(handlers.track).toHaveBeenNthCalledWith(3, 'scroll_depth', { depth: 75 })
		expect(handlers.track).toHaveBeenCalledTimes(3)

		setScroll({ scrollY: 0, innerHeight: 300, scrollHeight: 1000 })
		expect(handlers.track).toHaveBeenCalledTimes(3)
		expect(tracking.scrollDepth()).toBe(80)
	})

	it('resets its thresholds and its depth on a new page', () => {
		const tracking = start()
		setScroll({ scrollY: 700, innerHeight: 300, scrollHeight: 1000 })
		expect(tracking.scrollDepth()).toBe(100)
		handlers.track.mockClear()

		tracking.resetPage()
		expect(tracking.scrollDepth()).toBe(0)
		setScroll({ scrollY: 700, innerHeight: 300, scrollHeight: 1000 })
		expect(handlers.track).toHaveBeenCalledWith('scroll_depth', { depth: 100 })
		expect(tracking.scrollDepth()).toBe(100)
	})

	it('measures a burst of scroll events once per animation frame', () => {
		const frames = vi.spyOn(window, 'requestAnimationFrame')
		const tracking = start()
		layOut({ scrollY: 500, innerHeight: 300, scrollHeight: 1000 })
		for (let i = 0; i < 5; i++) {
			window.dispatchEvent(new Event('scroll'))
		}
		expect(frames).toHaveBeenCalledTimes(1)
		expect(tracking.scrollDepth()).toBe(0)

		vi.advanceTimersByTime(FRAME_MS)
		expect(tracking.scrollDepth()).toBe(80)
		frames.mockRestore()
	})

	// A single-page app swaps the layout before the next pageview asks for the old page's depth.
	it('keeps the deepest point the page reached, whatever the layout says when it is asked', () => {
		const tracking = start()
		tracking.resetPage()
		setScroll({ scrollY: 300, innerHeight: 300, scrollHeight: 1000 })
		layOut({ scrollY: 0, innerHeight: 300, scrollHeight: 350 })

		expect(tracking.scrollDepth()).toBe(60)
	})

	it('counts the first screen of a page that is never scrolled, once it has had a second to render', () => {
		const tracking = start()
		tracking.resetPage()
		layOut({ scrollY: 0, innerHeight: 300, scrollHeight: 400 })
		vi.advanceTimersByTime(999)
		expect(tracking.scrollDepth()).toBe(0)

		vi.advanceTimersByTime(1)
		expect(tracking.scrollDepth()).toBe(75)
		expect(handlers.track).not.toHaveBeenCalled()
	})

	it("gives each page its own second to render, cancelling the previous page's wait", () => {
		const tracking = start()
		tracking.resetPage()
		vi.advanceTimersByTime(500)
		tracking.resetPage()
		layOut({ scrollY: 0, innerHeight: 300, scrollHeight: 1000 })
		vi.advanceTimersByTime(500)
		expect(tracking.scrollDepth()).toBe(0)

		vi.advanceTimersByTime(500)
		expect(tracking.scrollDepth()).toBe(30)
	})

	it('reports no depth at all when the toggle is off', () => {
		const tracking = start({ scrollDepth: false })
		tracking.resetPage()
		setScroll({ scrollY: 500, innerHeight: 300, scrollHeight: 1000 })
		vi.advanceTimersByTime(1000)

		expect(handlers.track).not.toHaveBeenCalled()
		expect(tracking.scrollDepth()).toBeUndefined()
	})
})

describe('destroy', () => {
	it('detaches every listener', () => {
		const tracking = start()
		tracking.destroy()
		capture = null
		document.body.innerHTML = '<a href="https://example.com/" data-analytics-goal="signup">go</a>'
		clickOn(document.querySelector('a') as HTMLAnchorElement)
		setScroll({ scrollY: 500, innerHeight: 300, scrollHeight: 1000 })

		expect(handlers.track).not.toHaveBeenCalled()
		expect(handlers.trackGoal).not.toHaveBeenCalled()
	})

	it('cancels a measurement still waiting for its frame or its page to render', () => {
		const tracking = start()
		tracking.resetPage()
		layOut({ scrollY: 700, innerHeight: 300, scrollHeight: 1000 })
		window.dispatchEvent(new Event('scroll'))
		tracking.destroy()
		capture = null
		vi.advanceTimersByTime(1000)

		expect(handlers.track).not.toHaveBeenCalled()
		expect(tracking.scrollDepth()).toBe(0)
	})
})

describe('the custom event attribute', () => {
	it('fires a named event on click, with its prop attributes', () => {
		start()
		document.body.innerHTML =
			'<button data-analytics-event="cta_click" data-analytics-prop-plan="pro">Go</button>'
		const button = document.querySelector('button')
		if (button) clickOn(button)
		expect(handlers.track).toHaveBeenCalledWith('cta_click', { plan: 'pro' })
	})

	it('fires it on submit too, from the nearest ancestor carrying it', () => {
		start()
		document.body.innerHTML =
			'<form data-analytics-event="signup"><button type="submit">Go</button></form>'
		const form = document.querySelector('form')
		form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
		expect(handlers.track).toHaveBeenCalledWith('signup', undefined)
	})

	it('reads a goal and a custom event on the same element independently', () => {
		start()
		document.body.innerHTML =
			'<button data-analytics-goal="book-demo" data-analytics-event="cta_click">Go</button>'
		const button = document.querySelector('button')
		if (button) clickOn(button)
		expect(handlers.trackGoal).toHaveBeenCalledWith('book-demo', {})
		expect(handlers.track).toHaveBeenCalledWith('cta_click', undefined)
	})
})

describe('content items', () => {
	const card = (inner: string) =>
		`<article data-analytics-item="offers:7" data-analytics-item-name="Spring sale">${inner}</article>`
	const spring = { item: 'offers:7', itemName: 'Spring sale' }

	it('sends item_click for a click anywhere inside an item, with its name for the vendors', () => {
		start()
		document.body.innerHTML = card('<p id="copy">Half price</p>')
		clickOn(document.getElementById('copy') as HTMLElement)
		expect(handlers.track).toHaveBeenCalledWith('item_click', undefined, spring)
	})

	it('sends it once per item and pageview, and again after the next pageview', () => {
		const tracking = start()
		document.body.innerHTML = card('<p id="copy">Half price</p>')
		const copy = document.getElementById('copy') as HTMLElement
		clickOn(copy)
		clickOn(copy)
		expect(handlers.track).toHaveBeenCalledTimes(1)
		tracking.resetPage()
		clickOn(copy)
		expect(handlers.track).toHaveBeenCalledTimes(2)
	})

	it('credits a goal and a custom event fired inside an item to that item', () => {
		start()
		document.body.innerHTML = card(
			'<button data-analytics-goal="book-demo" data-analytics-event="cta_click">Book</button>'
		)
		clickOn(document.querySelector('button') as HTMLButtonElement)
		expect(handlers.trackGoal).toHaveBeenCalledWith('book-demo', spring)
		expect(handlers.track).toHaveBeenCalledWith('cta_click', undefined, spring)
	})

	it('credits a form submitted inside an item to it', () => {
		start()
		document.body.innerHTML = card(
			'<form data-analytics-goal="newsletter"><button type="submit">Join</button></form>'
		)
		const form = document.querySelector('form')
		form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
		expect(handlers.trackGoal).toHaveBeenCalledWith('newsletter', spring)
	})

	it('ignores an element whose ref ingest would refuse', () => {
		start()
		document.body.innerHTML =
			'<article data-analytics-item="offers"><button data-analytics-goal="book-demo">Book</button></article>'
		clickOn(document.querySelector('button') as HTMLButtonElement)
		expect(handlers.track).not.toHaveBeenCalled()
		expect(handlers.trackGoal).toHaveBeenCalledWith('book-demo', {})
	})

	it('keeps crediting goals to their item with clicks off, and sends no item_click', () => {
		start({ items: { impressions: true, clicks: false, pages: true } })
		document.body.innerHTML = card('<button data-analytics-goal="book-demo">Book</button>')
		clickOn(document.querySelector('button') as HTMLButtonElement)
		expect(handlers.track).not.toHaveBeenCalled()
		expect(handlers.trackGoal).toHaveBeenCalledWith('book-demo', spring)
	})

	it('does neither with items turned off altogether', () => {
		start({ items: { impressions: false, clicks: false, pages: false } })
		document.body.innerHTML = card('<button data-analytics-goal="book-demo">Book</button>')
		clickOn(document.querySelector('button') as HTMLButtonElement)
		expect(handlers.track).not.toHaveBeenCalled()
		expect(handlers.trackGoal).toHaveBeenCalledWith('book-demo', {})
	})

	it('listens for item clicks even with every other click toggle off', () => {
		start({ outboundLinks: false, fileDownloads: false, goalAttribute: false })
		document.body.innerHTML = card('<p id="copy">Half price</p>')
		clickOn(document.getElementById('copy') as HTMLElement)
		expect(handlers.track).toHaveBeenCalledWith('item_click', undefined, spring)
	})

	it('keeps items on for a config snapshot rendered before they existed', () => {
		const { items: _items, ...older } = ALL_ON
		capture = createAutoCapture({
			win: window,
			options: older as ResolvedAutoCapture,
			handlers,
		})
		document.body.innerHTML = card('<p id="copy">Half price</p>')
		clickOn(document.getElementById('copy') as HTMLElement)
		expect(handlers.track).toHaveBeenCalledWith('item_click', undefined, spring)
	})
})
