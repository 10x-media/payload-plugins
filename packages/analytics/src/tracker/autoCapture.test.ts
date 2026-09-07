import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedAutoCapture } from '../core/options'
import { type AutoCapture, type AutoCaptureHandlers, createAutoCapture } from './autoCapture'

const ALL_ON: ResolvedAutoCapture = {
	scrollDepth: true,
	outboundLinks: true,
	fileDownloads: true,
	goalAttribute: true,
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

const setScroll = (args: { scrollY: number; innerHeight: number; scrollHeight: number }) => {
	Object.defineProperty(window, 'scrollY', { value: args.scrollY, configurable: true })
	Object.defineProperty(window, 'innerHeight', { value: args.innerHeight, configurable: true })
	Object.defineProperty(document.documentElement, 'scrollHeight', {
		value: args.scrollHeight,
		configurable: true,
	})
	window.dispatchEvent(new Event('scroll'))
}

beforeEach(() => {
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
			url: 'https://cdn.example.com/a.ZIP?v=2',
		})
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

	it('reports a form submit', () => {
		start()
		document.body.innerHTML =
			'<form data-analytics-goal="contact" data-analytics-value="10"><input name="a" /></form>'
		const form = document.querySelector('form') as HTMLFormElement
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

		expect(handlers.trackGoal).toHaveBeenCalledWith('contact', { value: 10 })
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

	it('resets its thresholds on a new page', () => {
		const tracking = start()
		setScroll({ scrollY: 700, innerHeight: 300, scrollHeight: 1000 })
		expect(tracking.scrollDepth()).toBe(100)
		handlers.track.mockClear()

		tracking.resetPage()
		expect(tracking.scrollDepth()).toBe(100)
		setScroll({ scrollY: 700, innerHeight: 300, scrollHeight: 1000 })
		expect(handlers.track).toHaveBeenCalledWith('scroll_depth', { depth: 100 })
	})

	it('reports no depth at all when the toggle is off', () => {
		const tracking = start({ scrollDepth: false })
		setScroll({ scrollY: 500, innerHeight: 300, scrollHeight: 1000 })

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
})
