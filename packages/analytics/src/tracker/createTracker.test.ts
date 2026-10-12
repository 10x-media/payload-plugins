import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GA4_DISABLE_PREFIX } from '../adapters/ga4/disableKey'
import { exclusionToken, exclusionTokenHash, publicDigest } from '../capture/exclusionToken'
import { MAX_QUERY_LENGTH } from '../query/limits'
import type { TrackerConfig, TrackerSlotConfig } from './config'
import { createTracker } from './createTracker'
import { EXCLUSION_STASH_KEY, EXCLUSION_STORAGE_KEY } from './exclusion'
import { GATE_QUEUE_LIMIT, LEGACY_CONSENT_KEYS } from './gate'
import { PLAUSIBLE_IGNORE_KEY } from './sinks/plausible'
import { UMAMI_DISABLED_KEY } from './sinks/umami'
import { VENDOR_GLOBAL_POLL_MS } from './sinks/vendor'
import type { LoadScript, Tracker, TrackerEvent, TrackerOptions } from './types'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const posted = (): Array<TrackerEvent & { url: string }> =>
	fetchMock.mock.calls.map((call) => {
		const [url, init] = call as unknown as [string, RequestInit]
		return { url, ...(JSON.parse(init.body as string) as TrackerEvent) }
	})

/** What was posted besides the pageviews, which go out the moment a page is tracked. */
const postedHits = () => posted().filter((event) => event.type !== 'pageview')

const nativeSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'native',
	adapterId: 'native',
	path: '/api/_x/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	gated: false,
}

const posthogSlot: TrackerSlotConfig = {
	slot: 'tenant',
	kind: 'posthog',
	adapterId: 'posthog',
	path: '/api/_x/p/tenant',
	snippet: { scripts: [{ src: '/api/_x/p/tenant/static/array.js' }] },
	client: { kind: 'posthog', token: 'tok' },
	gated: true,
}

const plausibleSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'plausible',
	adapterId: 'plausible',
	path: '/api/_x/p/global',
	snippet: { scripts: [{ src: '/api/_x/p/global/js/script.js' }] },
	client: { kind: 'plausible' },
	gated: false,
}

const umamiSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'umami',
	adapterId: 'umami',
	path: '/api/_x/p/global',
	snippet: { scripts: [{ src: '/api/_x/p/global/script.js' }] },
	client: { kind: 'umami' },
	gated: false,
}

const ga4Slot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'ga4',
	adapterId: 'ga4',
	path: '/api/_x/p/global',
	snippet: { scripts: [{ src: '/api/_x/p/global/gtag/js' }] },
	client: { kind: 'ga4', measurementId: 'G-TEST' },
	gated: false,
}

const configWith = (
	slots: TrackerSlotConfig[],
	extra: Partial<TrackerConfig> = {}
): TrackerConfig => ({
	slots,
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
		query: true,
		items: { impressions: false, clicks: false, pages: false },
	},
	goals: [],
	ingestPath: '/api/_x/e',
	...extra,
})

let capture: ReturnType<typeof vi.fn>
let optOut: ReturnType<typeof vi.fn>
let optIn: ReturnType<typeof vi.fn>
let loadScript: ReturnType<typeof vi.fn> & LoadScript
let trackers: Tracker[]

const boot = (
	config: TrackerConfig,
	options: Omit<TrackerOptions, 'loadScript' | 'window'> = {}
): Tracker => {
	const tracker = createTracker(config, { window, loadScript, ...options })
	trackers.push(tracker)
	return tracker
}

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
	window.history.replaceState(null, '', '/pricing')
	capture = vi.fn()
	optOut = vi.fn()
	optIn = vi.fn()
	Object.defineProperty(window, 'posthog', {
		value: { capture, opt_out_capturing: optOut, opt_in_capturing: optIn },
		configurable: true,
	})
	Reflect.deleteProperty(window, `${GA4_DISABLE_PREFIX}G-TEST`)
	loadScript = vi.fn(() => Promise.resolve()) as ReturnType<typeof vi.fn> & LoadScript
	trackers = []
})

afterEach(() => {
	for (const tracker of trackers) {
		tracker.destroy()
	}
	Reflect.deleteProperty(document, 'visibilityState')
	vi.useRealTimers()
})

const withScroll = (slots: TrackerSlotConfig[]): TrackerConfig =>
	configWith(slots, {
		autoCapture: {
			scrollDepth: true,
			outboundLinks: false,
			fileDownloads: false,
			goalAttribute: false,
			query: true,
			items: { impressions: false, clicks: false, pages: false },
		},
	})

/** One animation frame: what a scroll waits for before it is measured. */
const FRAME_MS = 16

const hideTab = () => {
	Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
	document.dispatchEvent(new Event('visibilitychange'))
}

const showTab = () => {
	Reflect.deleteProperty(document, 'visibilityState')
	document.dispatchEvent(new Event('visibilitychange'))
}

describe('page tracking', () => {
	it('sends the boot pageview at once, with no duration', () => {
		boot(configWith([nativeSlot]))

		expect(posted()).toEqual([
			{ url: '/api/_x/e', type: 'pageview', path: '/pricing', hostname: 'localhost' },
		])
	})

	it('marks the pageview as measuring scroll only while scroll capture is on', () => {
		boot(withScroll([nativeSlot]))
		boot(configWith([nativeSlot]))

		expect(posted()[0]?.scrollDepth).toBe(0)
		expect(posted()[1]).not.toHaveProperty('scrollDepth')
	})

	it("sends the previous page's engagement before the next SPA pageview", () => {
		vi.useFakeTimers()
		window.history.replaceState(null, '', '/pricing?utm_source=newsletter')
		boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(3000)
		window.history.pushState(null, '', '/checkout')

		expect(
			posted().map(({ type, path, query, durationMs, sinceMs }) => [
				type,
				path,
				query,
				durationMs,
				sinceMs,
			])
		).toEqual([
			['pageview', '/pricing', 'utm_source=newsletter', undefined, undefined],
			['engagement', '/pricing', 'utm_source=newsletter', 3000, 3000],
			['pageview', '/checkout', undefined, undefined, undefined],
		])
	})

	// The referrer stays the one the document was loaded with, so ingest must not read it again.
	it('marks every pageview after the first as a navigation inside the loaded page', () => {
		const tracker = boot(configWith([nativeSlot]))
		window.history.pushState(null, '', '/checkout')
		window.history.replaceState(null, '', '/thanks')
		tracker.page()

		expect(
			posted()
				.filter((event) => event.type === 'pageview')
				.map(({ path, nav }) => [path, nav])
		).toEqual([
			['/pricing', undefined],
			['/checkout', 1],
			['/thanks', 1],
			['/thanks', 1],
		])
	})

	it('puts the navigation mark on pageviews alone', () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([nativeSlot]))
		window.history.pushState(null, '', '/checkout')
		tracker.track('signup')
		vi.advanceTimersByTime(2000)
		tracker.flush()

		const marked = posted().filter((event) => event.nav !== undefined)
		expect(marked.map(({ type, path }) => [type, path])).toEqual([['pageview', '/checkout']])
		expect(posted().map(({ type }) => type)).toEqual([
			'pageview',
			'pageview',
			'event',
			'engagement',
		])
	})

	it('sends the visible time when the tab is hidden, and only the new time after that', () => {
		vi.useFakeTimers()
		boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(4000)
		hideTab()
		vi.advanceTimersByTime(30_000)
		showTab()
		vi.advanceTimersByTime(2000)
		hideTab()
		showTab()

		expect(
			posted()
				.filter((event) => event.type === 'engagement')
				.map((event) => event.durationMs)
		).toEqual([4000, 2000])
	})

	it('sends the deeper scroll as an increase over the deepest one already sent', () => {
		vi.useFakeTimers()
		const original = Object.getOwnPropertyDescriptor(
			window.Element.prototype,
			'scrollHeight'
		) as PropertyDescriptor
		Object.defineProperty(document.documentElement, 'scrollHeight', {
			configurable: true,
			value: 1000,
		})
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
		Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
		boot(withScroll([nativeSlot]))
		Object.defineProperty(window, 'scrollY', { configurable: true, value: 300 })
		window.dispatchEvent(new Event('scroll'))
		vi.advanceTimersByTime(FRAME_MS)
		hideTab()
		showTab()
		Object.defineProperty(window, 'scrollY', { configurable: true, value: 700 })
		window.dispatchEvent(new Event('scroll'))
		vi.advanceTimersByTime(FRAME_MS)
		hideTab()
		showTab()

		expect(
			posted()
				.filter((event) => event.type === 'engagement')
				.map((event) => event.scrollDepth)
		).toEqual([60, 40])
		Object.defineProperty(document.documentElement, 'scrollHeight', original)
		Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
	})

	// A router swaps in the next page's layout, and resets the scroll, before it tells history.
	it("sends the depth the old page reached on a navigation, not the new layout's", () => {
		vi.useFakeTimers()
		const original = Object.getOwnPropertyDescriptor(
			window.Element.prototype,
			'scrollHeight'
		) as PropertyDescriptor
		const layOut = (scrollY: number, scrollHeight: number) => {
			Object.defineProperty(document.documentElement, 'scrollHeight', {
				configurable: true,
				value: scrollHeight,
			})
			Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY })
		}
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
		layOut(0, 1000)
		boot(withScroll([nativeSlot]))
		layOut(300, 1000)
		window.dispatchEvent(new Event('scroll'))
		vi.advanceTimersByTime(FRAME_MS)
		layOut(0, 350)
		window.history.pushState(null, '', '/checkout')

		expect(
			posted()
				.filter((event) => event.type === 'engagement')
				.map((event) => [event.path, event.scrollDepth])
		).toEqual([['/pricing', 60]])
		Object.defineProperty(document.documentElement, 'scrollHeight', original)
		Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
	})

	it('sends nothing more on pagehide when nothing is new', () => {
		boot(configWith([nativeSlot]))
		window.dispatchEvent(new Event('pagehide'))

		expect(posted().map((event) => event.type)).toEqual(['pageview'])
	})

	it('sends the engagement on pagehide', () => {
		vi.useFakeTimers()
		boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(2500)
		window.dispatchEvent(new Event('pagehide'))

		expect(posted()[1]).toMatchObject({ type: 'engagement', path: '/pricing', durationMs: 2500 })
	})

	it('sends the engagement on flush', () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(1500)
		tracker.flush()

		expect(posted()[1]).toMatchObject({ type: 'engagement', durationMs: 1500 })
	})

	it("carries the referrer's origin when the document has one", () => {
		Object.defineProperty(document, 'referrer', {
			value: 'https://google.com/',
			configurable: true,
		})
		boot(configWith([nativeSlot]))

		expect(posted()[0]?.referrer).toBe('https://google.com')
		Object.defineProperty(document, 'referrer', { value: '', configurable: true })
	})

	// A same-origin navigation puts the previous page's whole address in document.referrer.
	it("sends the referrer's origin alone, never its path, query or fragment", () => {
		Object.defineProperty(document, 'referrer', {
			value: 'https://localhost:3000/account/reset?token=s3cret&email=a%40b.test#done',
			configurable: true,
		})
		boot(configWith([nativeSlot])).track('signup')

		expect(posted().map((event) => [event.type, event.referrer])).toEqual([
			['pageview', 'https://localhost:3000'],
			['event', 'https://localhost:3000'],
		])
		expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('s3cret')
		Object.defineProperty(document, 'referrer', { value: '', configurable: true })
	})

	it('sends no referrer for one that names no web origin', () => {
		for (const value of ['about:blank', 'android-app://com.example/', 'not a url']) {
			fetchMock.mockClear()
			Object.defineProperty(document, 'referrer', { value, configurable: true })
			boot(configWith([nativeSlot]))

			expect(posted()[0]).not.toHaveProperty('referrer')
		}
		Object.defineProperty(document, 'referrer', { value: '', configurable: true })
	})
})

// Chrome prerenders a page a visitor may never open; until it is shown, nothing about it counts.
describe('a prerendered page', () => {
	const setPrerendering = (value: boolean) => {
		Object.defineProperty(document, 'prerendering', { value, configurable: true })
	}

	const show = () => {
		setPrerendering(false)
		document.dispatchEvent(new Event('prerenderingchange'))
	}

	afterEach(() => {
		Reflect.deleteProperty(document, 'prerendering')
	})

	it('sends no pageview and measures nothing while it is only prerendered', () => {
		vi.useFakeTimers()
		setPrerendering(true)
		const tracker = boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(5000)
		tracker.flush()

		expect(posted()).toEqual([])
	})

	it('is tracked once shown, its time counted from then on', () => {
		vi.useFakeTimers()
		setPrerendering(true)
		const tracker = boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(5000)
		show()
		vi.advanceTimersByTime(2000)
		tracker.flush()

		expect(posted().map((event) => [event.type, event.path, event.durationMs])).toEqual([
			['pageview', '/pricing', undefined],
			['engagement', '/pricing', 2000],
		])
	})

	it('sends one pageview, for where it was when shown, however the prerender navigated', () => {
		setPrerendering(true)
		boot(configWith([nativeSlot]))
		window.history.pushState(null, '', '/checkout')
		window.history.pushState(null, '', '/thanks')
		show()

		expect(posted().map((event) => [event.type, event.path])).toEqual([['pageview', '/thanks']])
	})

	it('stops waiting for it to be shown once destroyed', () => {
		setPrerendering(true)
		boot(configWith([nativeSlot])).destroy()
		show()

		expect(posted()).toEqual([])
	})

	it('injects no vendor script and calls no vendor while prerendered, and does both once shown', async () => {
		setPrerendering(true)
		const tracker = boot(configWith([{ ...posthogSlot, gated: false }]))
		tracker.track('while-prerendered')
		await Promise.resolve()

		expect(loadScript).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()

		show()

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledWith('while-prerendered', expect.anything())
		})
		expect(loadScript).toHaveBeenCalledTimes(1)
	})

	it('loads a slot the host opens while prerendered only once the page is shown', async () => {
		setPrerendering(true)
		const tracker = boot(configWith([posthogSlot]))
		tracker.setGate(true)
		await Promise.resolve()

		expect(loadScript).not.toHaveBeenCalled()

		show()

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
	})

	it('loads nothing once shown for a slot closed while prerendered', async () => {
		setPrerendering(true)
		const tracker = boot(configWith([{ ...posthogSlot, gated: false }]))
		tracker.track('dropped')
		tracker.setGate({ tenant: false })
		show()
		await Promise.resolve()

		expect(loadScript).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
	})
})

describe('query string capture', () => {
	it('carries the campaign keys alone on a pageview, never the rest of the address', () => {
		window.history.replaceState(
			null,
			'',
			'/pricing?utm_source=newsletter&page=2&email=a%40b.example&gclid=Cj0-secret-click'
		)
		boot(configWith([nativeSlot]))

		expect(posted()[0]?.query).toBe('utm_source=newsletter&gclid=1')
		expect(posted()[0]?.path).toBe('/pricing')
		expect(JSON.stringify(posted())).not.toMatch(/page=2|a%40b|secret/)
	})

	it('omits the query on a page with none', () => {
		boot(configWith([nativeSlot]))

		expect(posted()[0]).not.toHaveProperty('query')
	})

	it('never carries the query on an event or a goal', () => {
		window.history.replaceState(null, '', '/pricing?utm_source=newsletter')
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('signup')
		tracker.trackGoal('checkout')

		expect(postedHits()).toHaveLength(2)
		expect(postedHits()[0]).not.toHaveProperty('query')
		expect(postedHits()[1]).not.toHaveProperty('query')
	})

	it('sends nothing when autoCapture.query is off', () => {
		window.history.replaceState(null, '', '/pricing?utm_source=newsletter')
		boot(
			configWith([nativeSlot], {
				autoCapture: {
					scrollDepth: false,
					outboundLinks: false,
					fileDownloads: false,
					goalAttribute: false,
					query: false,
					items: { impressions: false, clicks: false, pages: false },
				},
			})
		)

		expect(posted()[0]).not.toHaveProperty('query')
	})

	it('caps the query it sends', () => {
		const long = '%E2%82%AC'.repeat(MAX_QUERY_LENGTH)
		window.history.replaceState(null, '', `/pricing?utm_source=${long}&utm_medium=${long}`)
		boot(configWith([nativeSlot]))

		expect(posted()[0]?.query?.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH)
	})
})

describe('track and trackGoal', () => {
	it('sends an event immediately, with its props', () => {
		boot(configWith([nativeSlot])).track('signup', { plan: 'pro' })

		expect(postedHits()[0]).toMatchObject({
			type: 'event',
			name: 'signup',
			path: '/pricing',
			hostname: 'localhost',
			props: { plan: 'pro' },
		})
	})

	it('defaults a goal value from the config, and lets the call override it', () => {
		const config = configWith([nativeSlot], {
			goals: [{ slug: 'checkout', match: { kind: 'goal' }, value: { fixed: 49 }, currency: 'EUR' }],
		})
		const tracker = boot(config)
		tracker.trackGoal('checkout')
		tracker.trackGoal('checkout', { value: 99, currency: 'USD' })

		expect(postedHits()[0]).toMatchObject({
			type: 'goal',
			name: 'checkout',
			value: 49,
			currency: 'EUR',
		})
		expect(postedHits()[1]).toMatchObject({ value: 99, currency: 'USD' })
	})

	it('sends a goal the config snapshot does not know', () => {
		boot(configWith([nativeSlot])).trackGoal('newsletter')

		expect(postedHits()[0]).toMatchObject({ type: 'goal', name: 'newsletter' })
		expect(postedHits()[0]).not.toHaveProperty('value')
	})
})

describe('the gate', () => {
	it('holds events for a pending slot and never loads its script', () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('signup')

		expect(tracker.gate.tenant).toBe('pending')
		expect(loadScript).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
	})

	it('opens: injects the snippet, then sends what waited, in order', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('first')
		tracker.track('second')
		tracker.setGate(true)

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(2)
		})
		expect(capture.mock.calls.map((call) => call[0])).toEqual(['first', 'second'])
		expect(loadScript).toHaveBeenCalledTimes(1)
		expect(tracker.gate.tenant).toBe('open')
	})

	// The vendor never ran on this page, so its switch is not written: refusing stores nothing.
	it('closes: drops what waited and sends nothing more, writing no switch for a vendor never loaded', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('first')
		tracker.setGate(false)
		tracker.track('second')

		expect(tracker.gate.tenant).toBe('closed')
		expect(optOut).not.toHaveBeenCalled()
		tracker.setGate(true)

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		expect(capture).not.toHaveBeenCalled()
	})

	it('sets the vendor opt-out when a slot whose script ran is closed', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.setGate(true)
		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})

		tracker.setGate(false)

		expect(optOut).toHaveBeenCalledTimes(1)
	})

	it('writes no switch for a refusal on a slot whose vendor never loaded', () => {
		const tracker = boot(
			configWith([
				{ ...plausibleSlot, gated: true },
				{ ...umamiSlot, slot: 'tenant', gated: true },
			])
		)
		tracker.setGate(false)

		expect(Object.keys(window.localStorage)).toEqual([])
		expect(tracker.gate).toEqual({ global: 'closed', tenant: 'closed' })
	})

	it('writes no switch for a refusal the server already knew at boot', () => {
		boot(configWith([{ ...plausibleSlot, gated: true }]), { gate: false })

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
	})

	it('reads a slot the config does not fill as closed, whatever the answer', () => {
		const tracker = boot(configWith([nativeSlot]))
		expect(tracker.gate).toEqual({ global: 'open', tenant: 'closed' })

		tracker.setGate({ tenant: true })

		expect(tracker.gate.tenant).toBe('closed')
	})

	it('keeps only the newest events once a slot queue is full', async () => {
		const tracker = boot(configWith([posthogSlot]))
		for (let i = 0; i < GATE_QUEUE_LIMIT + 3; i += 1) {
			tracker.track(`event-${i}`)
		}
		tracker.setGate(true)

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(GATE_QUEUE_LIMIT)
		})
		expect(capture.mock.calls[0]?.[0]).toBe('event-3')
	})

	it('stores nothing, so the next tracker starts pending whatever the last one was told', async () => {
		boot(configWith([posthogSlot])).setGate(true)
		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		const stored = Object.keys(window.localStorage).filter((key) => key.startsWith('analytics:'))

		const next = boot(configWith([posthogSlot]))

		expect(stored).toEqual([])
		expect(next.gate.tenant).toBe('pending')
		expect(loadScript).toHaveBeenCalledTimes(1)
	})

	it('deletes the decision 1.0.0-beta.11 stored once a slot opens, and never reads it', () => {
		window.localStorage.setItem('analytics:consent', 'granted')
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('signup')

		expect(window.localStorage.getItem('analytics:consent')).toBe('granted')
		expect(tracker.gate.tenant).toBe('pending')
		expect(loadScript).not.toHaveBeenCalled()

		tracker.setGate(false)
		expect(window.localStorage.getItem('analytics:consent')).toBe('granted')

		tracker.setGate(true)
		expect(window.localStorage.getItem('analytics:consent')).toBeNull()
		expect(LEGACY_CONSENT_KEYS).toEqual(['analytics:consent'])
	})

	it('reports every slot, and hands back the same snapshot until one changes', () => {
		const tracker = boot(configWith([nativeSlot, posthogSlot]))
		const before = tracker.gate

		tracker.setGate({ tenant: undefined })

		expect(tracker.gate).toBe(before)
		expect(before).toEqual({ global: 'open', tenant: 'pending' })
		expect(Object.isFrozen(before)).toBe(true)
		tracker.setGate(true)
		expect(tracker.gate).toEqual({ global: 'open', tenant: 'open' })
	})

	it('never holds a slot the server did not gate', () => {
		boot(configWith([nativeSlot])).track('signup')

		expect(postedHits()).toHaveLength(1)
	})

	it('answers held slots alone with a boolean, and closes an ungated slot only by name', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.setGate(false)
		tracker.track('still-counted')
		expect(postedHits()).toHaveLength(1)
		expect(tracker.gate.global).toBe('open')

		tracker.setGate({ global: false })
		tracker.track('dropped')
		expect(postedHits()).toHaveLength(1)
		expect(tracker.gate.global).toBe('closed')
	})

	it('applies the boot answer before the first pageview is sent', () => {
		boot(configWith([{ ...nativeSlot, gated: true }]), { gate: { global: true } })
		expect(posted().map((event) => event.type)).toEqual(['pageview'])

		fetchMock.mockClear()
		const closed = boot(configWith([{ ...nativeSlot, gated: true }]), { gate: false })
		closed.track('signup')
		expect(fetchMock).not.toHaveBeenCalled()
		expect(closed.gate.global).toBe('closed')
	})

	it('holds a pending native slot engagement, then delivers it after its pageview', () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([{ ...nativeSlot, gated: true }]))
		vi.advanceTimersByTime(3000)
		hideTab()
		expect(fetchMock).not.toHaveBeenCalled()

		tracker.setGate(true)

		expect(posted().map((event) => [event.type, event.durationMs])).toEqual([
			['pageview', undefined],
			['engagement', 3000],
		])
	})

	it('drops a native slot engagement once its gate is closed', () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([{ ...nativeSlot, gated: true }]))
		tracker.setGate(false)
		vi.advanceTimersByTime(3000)
		hideTab()
		tracker.setGate(true)

		expect(fetchMock).not.toHaveBeenCalled()
	})

	// Every vendor drops an engagement on delivery, so a held one only costs a queued event.
	it('holds no engagement for a pending vendor slot, keeping the queue for what it counts', async () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([posthogSlot]))
		for (let i = 0; i < GATE_QUEUE_LIMIT; i += 1) {
			tracker.track(`event-${i}`)
		}
		vi.advanceTimersByTime(3000)
		hideTab()
		showTab()
		tracker.setGate(true)

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(GATE_QUEUE_LIMIT)
		})
		expect(capture.mock.calls[0]?.[0]).toBe('event-0')
	})

	it('never hands an engagement to a vendor slot', () => {
		vi.useFakeTimers()
		boot(configWith([nativeSlot, { ...posthogSlot, gated: false }]))
		vi.advanceTimersByTime(3000)
		hideTab()

		expect(postedHits().map((event) => event.type)).toEqual(['engagement'])
		expect(capture).not.toHaveBeenCalled()
	})

	it('holds a slot from a 1.0.0-beta.11 config by its requiresConsent, and one carrying neither', () => {
		const { gated: _gated, ...withoutGate } = nativeSlot
		const cached = (extra: Record<string, unknown>): TrackerSlotConfig =>
			({ ...withoutGate, ...extra }) as unknown as TrackerSlotConfig

		expect(boot(configWith([cached({ requiresConsent: false })])).gate.global).toBe('open')
		expect(boot(configWith([cached({ requiresConsent: true })])).gate.global).toBe('pending')
		expect(boot(configWith([cached({})])).gate.global).toBe('pending')
		expect(postedHits()).toEqual([])
	})
})

describe('the gate, per slot', () => {
	const gatedPlausible: TrackerSlotConfig = { ...plausibleSlot, gated: true }

	it('answers for the named slot alone, leaving the other pending', async () => {
		const tracker = boot(configWith([gatedPlausible, posthogSlot]))
		tracker.track('signup')
		tracker.setGate({ tenant: true })

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledWith('signup', {})
		})
		expect(loadScript).toHaveBeenCalledTimes(1)
		expect(loadScript.mock.calls[0]?.[0]).toEqual(posthogSlot.snippet.scripts[0])
		expect(tracker.gate).toEqual({ global: 'pending', tenant: 'open' })
	})

	it('keeps the other slot queued rather than dropping its events', async () => {
		const tracker = boot(configWith([gatedPlausible, posthogSlot]))
		tracker.track('signup')
		tracker.setGate({ tenant: true })
		tracker.setGate({ global: true })

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(2)
		})
		expect(capture).toHaveBeenCalledTimes(1)
	})

	it('puts a revoke to the vendor and stops delivering to that slot alone', async () => {
		const tracker = boot(configWith([nativeSlot, posthogSlot]))
		tracker.setGate({ tenant: true })
		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})

		tracker.setGate({ tenant: false })
		tracker.track('after')

		expect(optOut).toHaveBeenCalledTimes(1)
		expect(capture).not.toHaveBeenCalled()
		// The other slot is untouched: a category was revoked, not the whole tracker.
		expect(postedHits()).toHaveLength(1)
	})

	it('clears the vendor switch a refusal on an earlier page left, when the slot opens', () => {
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		const tracker = boot(configWith([gatedPlausible, posthogSlot]))

		tracker.setGate(true)

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
		expect(optIn).toHaveBeenCalledWith({ captureEventName: false })
	})

	it('leaves the vendor switch set when the slot opens on an excluded browser', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		const tracker = boot(configWith([gatedPlausible]))

		tracker.setGate(true)

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
		expect(loadScript).not.toHaveBeenCalled()
	})

	it('clears an ungated slot switch on its first named answer, and does nothing on a repeat', () => {
		const tracker = boot(configWith([plausibleSlot]))
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')

		tracker.setGate(true)
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')

		tracker.setGate({ global: true })
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()

		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		tracker.setGate({ global: true })
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
	})

	it('does not lift a closed slot opt-out when the staff exclusion is cleared', () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.setGate({ tenant: false })
		tracker.exclude(true)
		tracker.exclude(false)

		expect(optIn).not.toHaveBeenCalled()
	})

	it('lifts its own opt-out when the same slot is opened again', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.setGate({ tenant: false })
		tracker.setGate({ tenant: true })

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		expect(optIn).toHaveBeenCalledTimes(1)
	})

	it('does nothing once destroyed', () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.destroy()
		tracker.setGate(true)

		expect(tracker.gate.tenant).toBe('pending')
		expect(loadScript).not.toHaveBeenCalled()
	})
})

describe('snippets: false', () => {
	afterEach(() => {
		Reflect.deleteProperty(window, 'umami')
	})

	it('injects nothing, and forwards to a vendor once its own global exists', async () => {
		vi.useFakeTimers()
		const track = vi.fn()
		const tracker = boot(configWith([{ ...umamiSlot, gated: true }]), { snippets: false })
		tracker.track('signup')
		tracker.setGate(true)

		await vi.advanceTimersByTimeAsync(VENDOR_GLOBAL_POLL_MS * 3)
		expect(loadScript).not.toHaveBeenCalled()
		expect(track).not.toHaveBeenCalled()

		Object.defineProperty(window, 'umami', { value: { track }, configurable: true })
		await vi.advanceTimersByTimeAsync(VENDOR_GLOBAL_POLL_MS)

		expect(track).toHaveBeenCalledWith('signup', {})
		expect(loadScript).not.toHaveBeenCalled()
	})

	it('still sends native beacons, which inject nothing anyway', () => {
		boot(configWith([nativeSlot]), { snippets: false }).track('signup')

		expect(postedHits()).toEqual([expect.objectContaining({ type: 'event', name: 'signup' })])
	})
})

describe('fan-out and teardown', () => {
	it('sends one event to every slot', async () => {
		const tracker = boot(configWith([nativeSlot, { ...posthogSlot, gated: false }]))
		tracker.track('signup')

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledWith('signup', {})
		})
		expect(postedHits()).toHaveLength(1)
	})

	it("sends the open page's engagement on destroy, then detaches", () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(2000)
		tracker.destroy()
		expect(posted().map((event) => event.type)).toEqual(['pageview', 'engagement'])

		vi.advanceTimersByTime(5000)
		window.history.pushState(null, '', '/after')
		hideTab()
		window.dispatchEvent(new Event('pagehide'))
		expect(posted()).toHaveLength(2)
	})
})

describe('one failing slot never takes the others down', () => {
	// A host that hands `track` a DOM node or any cyclic object makes the native sink's
	// JSON.stringify throw: a real failure, synchronous, inside send.
	const cyclic = (): Record<string, unknown> => {
		const props: Record<string, unknown> = { plan: 'pro' }
		props.self = props
		return props
	}

	it('keeps dispatching to later slots when one throws', async () => {
		const tracker = boot(configWith([nativeSlot, { ...posthogSlot, gated: false }]))
		tracker.track('warmup')
		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(1)
		})

		expect(() => tracker.track('signup', cyclic())).not.toThrow()

		expect(capture).toHaveBeenCalledTimes(2)
		expect(capture.mock.calls[1]?.[0]).toBe('signup')
	})

	it('still sends the time to every slot when reading the scroll position throws', () => {
		vi.useFakeTimers()
		const original = Object.getOwnPropertyDescriptor(
			window.Element.prototype,
			'scrollHeight'
		) as PropertyDescriptor
		Object.defineProperty(document.documentElement, 'scrollHeight', {
			configurable: true,
			get() {
				throw new Error('layout is gone')
			},
		})
		const tracker = boot(withScroll([nativeSlot, { ...nativeSlot, slot: 'tenant' }]))
		vi.advanceTimersByTime(2000)

		expect(() => tracker.flush()).not.toThrow()

		expect(postedHits()).toEqual([
			expect.objectContaining({ type: 'engagement', durationMs: 2000 }),
			expect.objectContaining({ type: 'engagement', durationMs: 2000 }),
		])
		expect(postedHits()[0]).not.toHaveProperty('scrollDepth')
		Object.defineProperty(document.documentElement, 'scrollHeight', original)
	})

	it('keeps draining a slot queue when one queued send throws', async () => {
		const tracker = boot(configWith([{ ...nativeSlot, gated: true }, posthogSlot]))
		tracker.track('signup', cyclic())

		expect(() => tracker.setGate(true)).not.toThrow()

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(1)
		})
		expect(capture.mock.calls[0]?.[0]).toBe('signup')
	})
})

describe('staff exclusion', () => {
	const TOKEN = exclusionToken('test-secret', null)
	const LINK = { param: 'analytics_exclude', tokenHash: exclusionTokenHash(TOKEN) }

	const openWith = (search: string) => {
		window.history.replaceState(null, '', `/pricing${search}`)
	}

	/** A config that hands out the exclusion link, as `capture.exclusion` does. */
	const linked = (slots: TrackerSlotConfig[], extra: Partial<TrackerConfig> = {}): TrackerConfig =>
		configWith(slots, { exclusion: LINK, ...extra })

	/** Waits out the token check, which the browser's own crypto answers on a later tick. */
	const checked = async (tracker: Tracker, excluded: boolean) => {
		await vi.waitFor(() => {
			expect(tracker.excluded).toBe(excluded)
		})
	}

	it('delivers nothing and loads nothing on a page opened with a signed link', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = boot(linked([nativeSlot, { ...posthogSlot, gated: false }]))
		tracker.track('while-checking')
		await checked(tracker, true)
		tracker.track('signup')
		tracker.trackGoal('checkout')
		tracker.flush()
		await Promise.resolve()

		expect(fetchMock).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
		expect(loadScript).not.toHaveBeenCalled()
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBe('1')
	})

	it('takes a signed link out of the address and keeps the rest of it', async () => {
		openWith(`?utm_source=newsletter&analytics_exclude=${TOKEN}#top`)
		await checked(boot(linked([nativeSlot])), true)

		expect(window.location.search).toBe('?utm_source=newsletter')
		expect(window.location.hash).toBe('#top')
	})

	// A rendered vendor snippet takes the parameter out first and leaves its value on the window.
	it('checks a token a rendered snippet already took out of the address, then forgets it', async () => {
		openWith('?utm_source=newsletter')
		Reflect.set(window, EXCLUSION_STASH_KEY, TOKEN)
		const tracker = boot(linked([nativeSlot]))
		await checked(tracker, true)

		expect(Reflect.get(window, EXCLUSION_STASH_KEY)).toBeUndefined()
		expect(window.location.search).toBe('?utm_source=newsletter')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('takes the link out of the address the moment it is read, before the token is checked', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = boot(linked([nativeSlot]))

		expect(window.location.search).toBe('')
		expect(tracker.excluded).toBe(false)
		await checked(tracker, true)
	})

	it('ignores the parameter entirely while the link is off', () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('signup')

		expect(tracker.excluded).toBe(false)
		expect(posted().map((event) => event.type)).toEqual(['pageview', 'event'])
		expect(window.location.search).toBe(`?analytics_exclude=${TOKEN}`)
	})

	it('ignores a =0 while the link is off, and honours a stored flag', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		openWith('?analytics_exclude=0')
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('signup')

		expect(tracker.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('ignores a wrong token, a forged 1 and a forged true, and still takes them out of the address', async () => {
		for (const value of ['wrong', '1', 'true']) {
			fetchMock.mockClear()
			openWith(`?analytics_exclude=${value}&utm_source=x`)
			const tracker = boot(linked([nativeSlot]))
			await vi.waitFor(() => {
				expect(posted().map((event) => event.type)).toContain('pageview')
			})

			expect(tracker.excluded).toBe(false)
			expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
			expect(window.location.search).toBe('?utm_source=x')
			expect(JSON.stringify(posted())).not.toContain('analytics_exclude')
		}
	})

	it('takes out a parameter too long or too empty to be a token', () => {
		for (const value of ['', 'x'.repeat(200)]) {
			openWith(`?analytics_exclude=${value}&utm_source=x`)
			boot(linked([nativeSlot]))

			expect(window.location.search).toBe('?utm_source=x')
		}
	})

	it('delivers what was sent while a wrong token was checked, after the pageview', async () => {
		openWith('?analytics_exclude=wrong')
		const tracker = boot(linked([nativeSlot]))
		tracker.track('early')
		expect(fetchMock).not.toHaveBeenCalled()

		await vi.waitFor(() => {
			expect(posted().map((event) => event.name ?? event.type)).toEqual(['pageview', 'early'])
		})
		expect(tracker.excluded).toBe(false)
	})

	it('puts the browser back with =0 or =false, no token needed, and drops it from the address', () => {
		for (const value of ['0', 'false']) {
			fetchMock.mockClear()
			window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
			openWith(`?analytics_exclude=${value}&utm_source=x`)
			const tracker = boot(linked([nativeSlot]))
			tracker.track('signup')

			expect(tracker.excluded).toBe(false)
			expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
			expect(posted().map((event) => event.type)).toEqual(['pageview', 'event'])
			expect(window.location.search).toBe('?utm_source=x')
		}
	})

	it('keeps the flag for the next page, where no link is needed', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		await checked(boot(linked([nativeSlot])), true)

		openWith('')
		const later = boot(linked([nativeSlot]))
		later.track('signup')

		expect(later.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('reads the link under the parameter the config names, and no other', async () => {
		const staff = { ...LINK, param: 'staff' }
		openWith(`?staff=${TOKEN}`)
		await checked(boot(configWith([nativeSlot], { exclusion: staff })), true)

		window.localStorage.clear()
		openWith(`?analytics_exclude=${TOKEN}`)
		const other = boot(configWith([nativeSlot], { exclusion: staff }))

		expect(other.excluded).toBe(false)
		expect(posted().map((event) => event.type)).toEqual(['pageview'])
	})

	it('injects no gated vendor script even once its gate opens', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = boot(linked([posthogSlot]))
		await checked(tracker, true)
		tracker.setGate(true)
		tracker.track('signup')
		await Promise.resolve()

		expect(loadScript).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
	})

	it('queues nothing while excluded, so clearing the flag replays nothing', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = boot(linked([posthogSlot]))
		await checked(tracker, true)
		tracker.track('skipped')
		tracker.exclude(false)
		tracker.setGate(true)

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		expect(capture).not.toHaveBeenCalled()
	})

	it('flips at runtime from host code, with the link off, and resumes from then on', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('before')
		tracker.exclude(true)
		tracker.track('during')
		expect(tracker.excluded).toBe(true)

		tracker.exclude(false)
		tracker.track('after')

		expect(postedHits().map((event) => event.name)).toEqual(['before', 'after'])
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
	})

	it('sends no engagement for a page opened excluded, even once the flag is cleared', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = boot(linked([nativeSlot]))
		await checked(tracker, true)
		vi.useFakeTimers()
		vi.advanceTimersByTime(3000)
		hideTab()
		showTab()
		tracker.exclude(false)
		vi.advanceTimersByTime(3000)
		hideTab()

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('ends the open page engagement when the browser is excluded at runtime', () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([nativeSlot]))
		vi.advanceTimersByTime(3000)
		tracker.exclude(true)
		tracker.exclude(false)
		vi.advanceTimersByTime(3000)
		hideTab()

		expect(posted().map((event) => event.type)).toEqual(['pageview'])
	})

	it('excludes this page alone when storage is blocked, and never throws', async () => {
		const denied = () => {
			throw new Error('denied')
		}
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)
		openWith(`?analytics_exclude=${TOKEN}`)

		const tracker = boot(linked([nativeSlot]))
		await checked(tracker, true)
		expect(() => tracker.track('signup')).not.toThrow()
		expect(fetchMock).not.toHaveBeenCalled()

		getItem.mockRestore()
		setItem.mockRestore()
		openWith('')
		expect(boot(linked([nativeSlot])).excluded).toBe(false)
	})

	it('sets every vendor own opt-out switch, and clears them when asked', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = boot(
			linked([plausibleSlot, umamiSlot, ga4Slot, { ...posthogSlot, gated: false }])
		)
		await checked(tracker, true)

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
		expect(window.localStorage.getItem(UMAMI_DISABLED_KEY)).toBe('1')
		expect(Reflect.get(window, `${GA4_DISABLE_PREFIX}G-TEST`)).toBe(true)
		expect(optOut).toHaveBeenCalledTimes(1)
		expect(optIn).not.toHaveBeenCalled()

		tracker.exclude(false)

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
		expect(window.localStorage.getItem(UMAMI_DISABLED_KEY)).toBeNull()
		expect(Reflect.get(window, `${GA4_DISABLE_PREFIX}G-TEST`)).toBe(false)
		expect(optIn).toHaveBeenCalledTimes(1)
	})

	it('re-asserts GA4 own switch on a boot that carries no parameter', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')

		expect(boot(configWith([ga4Slot])).excluded).toBe(true)
		expect(Reflect.get(window, `${GA4_DISABLE_PREFIX}G-TEST`)).toBe(true)
	})

	it('sends nothing for an auto-captured outbound click or scroll', async () => {
		const original = Object.getOwnPropertyDescriptor(
			window.Element.prototype,
			'scrollHeight'
		) as PropertyDescriptor
		Object.defineProperty(document.documentElement, 'scrollHeight', {
			configurable: true,
			value: 1000,
		})
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
		Object.defineProperty(window, 'scrollY', { configurable: true, value: 700 })
		// jsdom would try to follow the href, which it cannot do.
		const swallowNavigation = (event: Event) => event.preventDefault()
		document.addEventListener('click', swallowNavigation)
		document.body.innerHTML = '<a href="https://example.org/pricing">go</a>'
		openWith(`?analytics_exclude=${TOKEN}`)

		const tracker = boot(
			linked([nativeSlot], {
				autoCapture: {
					scrollDepth: true,
					outboundLinks: true,
					fileDownloads: false,
					goalAttribute: false,
					query: true,
					items: { impressions: false, clicks: false, pages: false },
				},
			})
		)
		await checked(tracker, true)
		document.body.firstElementChild?.dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true })
		)
		window.dispatchEvent(new Event('scroll'))

		expect(fetchMock).not.toHaveBeenCalled()
		document.body.innerHTML = ''
		document.removeEventListener('click', swallowNavigation)
		Object.defineProperty(document.documentElement, 'scrollHeight', original)
	})

	it('sends nothing for an SPA navigation', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		await checked(boot(linked([nativeSlot])), true)

		window.history.pushState(null, '', '/checkout')
		window.dispatchEvent(new Event('pagehide'))

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('empties a pending slot queue that already held events', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('before')
		tracker.exclude(true)
		tracker.setGate(true)
		await Promise.resolve()

		expect(capture).not.toHaveBeenCalled()
	})

	it('treats a stored value that is not the flag as not excluded', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, 'yes')
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('signup')

		expect(tracker.excluded).toBe(false)
		expect(postedHits()).toHaveLength(1)
	})

	it('never clears a vendor switch it did not set', () => {
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		window.localStorage.setItem(UMAMI_DISABLED_KEY, '1')

		boot(configWith([plausibleSlot, umamiSlot]))

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
		expect(window.localStorage.getItem(UMAMI_DISABLED_KEY)).toBe('1')
		expect(optIn).not.toHaveBeenCalled()
	})

	it('does nothing once destroyed while the token was still being checked', async () => {
		openWith(`?analytics_exclude=${TOKEN}`)
		const tracker = createTracker(linked([nativeSlot]), { window, loadScript })
		tracker.track('early')
		tracker.destroy()
		await new Promise((resolve) => setTimeout(resolve, 20))

		expect(fetchMock).not.toHaveBeenCalled()
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
		expect(window.location.search).toBe('')
	})
})

describe('purchase and refund', () => {
	it('sends an ordinary goal event, with no revenue flag for ingest to honour', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.purchase({ orderId: 'ord_1', value: 49, currency: 'EUR' })
		tracker.flush()
		const sale = posted().find((event) => event.name === 'purchase')

		expect(sale).toMatchObject({ type: 'goal', value: 49, currency: 'EUR', orderId: 'ord_1' })
		expect('revenue' in (sale ?? {})).toBe(false)
	})

	// Native keeps only a digest of the order id; a copy in props would store it in clear.
	it('leaves the order id out of the properties, on its own field alone', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.purchase({ value: 49, orderId: 'ord_1', props: { plan: 'pro' } })
		tracker.purchase({ value: 49, orderId: 'ord_2' })
		tracker.flush()
		const sales = posted().filter((event) => event.name === 'purchase')

		expect(sales.map((sale) => [sale.orderId, sale.props])).toEqual([
			['ord_1', { plan: 'pro' }],
			['ord_2', undefined],
		])
	})

	it('drops a negative amount, warning in development rather than sending a refund', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const tracker = boot(configWith([nativeSlot]))
		tracker.purchase({ value: -49, orderId: 'ord_1' })
		tracker.flush()

		expect(posted().some((event) => event.name === 'purchase')).toBe(false)
		expect(warn).toHaveBeenCalledOnce()
		warn.mockRestore()
	})

	it('carries the lines of the sale, capped', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.purchase({
			orderId: 'ord_1',
			value: 49,
			items: [
				{ id: 'sku-1', name: 'Mug', quantity: 2, price: 12 },
				{ name: 'no id' } as never,
				...Array.from({ length: 30 }, (_, index) => ({ id: `sku-${index + 2}` })),
			],
		})
		tracker.flush()
		const sale = posted().find((event) => event.name === 'purchase')

		expect(sale?.items).toHaveLength(20)
		expect(sale?.items?.[0]).toEqual({ id: 'sku-1', name: 'Mug', quantity: 2, price: 12 })
	})

	// A public beacon that could subtract from a bucket would let anyone forge a refund.
	it('does nothing at all for a refund, warning in development', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const tracker = boot(configWith([nativeSlot]))
		tracker.refund({ orderId: 'ord_1', value: 49 })
		tracker.flush()

		expect(posted().some((event) => event.name === 'purchase')).toBe(false)
		expect(warn).toHaveBeenCalledOnce()
		warn.mockRestore()
	})
})

/** The browser's visibility observer, driven by the test: it says which item is on screen. */
class ScreenObserver {
	static latest: ScreenObserver | null = null
	readonly observed = new Set<Element>()

	constructor(readonly callback: IntersectionObserverCallback) {
		ScreenObserver.latest = this
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

	show(el: Element) {
		const entry = {
			target: el,
			isIntersecting: true,
			intersectionRatio: 1,
			boundingClientRect: { height: 100 },
			intersectionRect: { height: 100 },
			rootBounds: { height: 800 },
		} as unknown as IntersectionObserverEntry
		this.callback([entry], this as unknown as IntersectionObserver)
	}
}

const withItems = (slots: TrackerSlotConfig[]): TrackerConfig =>
	configWith(slots, {
		autoCapture: {
			scrollDepth: false,
			outboundLinks: false,
			fileDownloads: false,
			goalAttribute: true,
			query: true,
			items: { impressions: true, clicks: true, pages: true },
		},
	})

const offerCard = (ref = 'offers:1'): HTMLElement => {
	const el = document.createElement('article')
	el.setAttribute('data-analytics-item', ref)
	el.setAttribute('data-analytics-item-name', 'Spring sale')
	el.innerHTML = '<button data-analytics-goal="book-demo" type="button">Book</button>'
	document.body.append(el)
	return el
}

const screen = (): ScreenObserver => {
	if (!ScreenObserver.latest) {
		throw new Error('nothing is watching the screen')
	}
	return ScreenObserver.latest
}

describe('content items', () => {
	beforeEach(() => {
		ScreenObserver.latest = null
		vi.stubGlobal('IntersectionObserver', ScreenObserver)
		document.body.replaceChildren()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		window.fetch = fetchMock as unknown as typeof fetch
		document.body.replaceChildren()
	})

	it('files an event, a goal and a sale under the item a call names', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('cta_click', undefined, { item: 'offers:1' })
		tracker.trackGoal('checkout', { value: 5, item: 'offers:1' })
		tracker.purchase({ value: 49, item: 'offers:1' })

		expect(postedHits().map((event) => event.item)).toEqual(['offers:1', 'offers:1', 'offers:1'])
	})

	it('leaves off an item ref ingest would refuse', () => {
		boot(configWith([nativeSlot])).track('cta_click', undefined, { item: 'offers' })

		expect(postedHits()[0]).not.toHaveProperty('item')
	})

	it('sends native a signed item whole, as the server wrote it, from a call and from the page', () => {
		const signed = 'offers:1@AbCdEf-_1234'
		const card = offerCard(signed)
		const tracker = boot(withItems([nativeSlot]))
		tracker.track('cta_click', undefined, { item: signed })
		tracker.track('cta_click', undefined, { item: 'offers:1@short' })
		card.querySelector('button')?.click()

		expect(postedHits().map((event) => [event.name, event.item])).toEqual([
			['cta_click', signed],
			['cta_click', undefined],
			['item_click', signed],
			['book-demo', signed],
		])
	})

	it('sends the click and the goal with the item, and keeps its name off the native wire', () => {
		const card = offerCard()
		boot(withItems([nativeSlot]))
		card.querySelector('button')?.click()

		const hits = postedHits()
		expect(hits.map((event) => [event.type, event.name, event.item])).toEqual([
			['event', 'item_click', 'offers:1'],
			['goal', 'book-demo', 'offers:1'],
		])
		expect(hits.every((event) => event.itemName === undefined)).toBe(true)
	})

	it('carries the items seen on the next engagement', () => {
		vi.useFakeTimers()
		const card = offerCard()
		const tracker = boot(withItems([nativeSlot]))
		screen().show(card)
		vi.advanceTimersByTime(1000)
		tracker.flush()

		expect(postedHits()).toMatchObject([
			{ type: 'engagement', path: '/pricing', impressions: ['offers:1'] },
		])
	})

	it('sends an engagement early once the items seen fill one', () => {
		vi.useFakeTimers()
		const cards = Array.from({ length: 50 }, (_, index) => offerCard(`offers:${index}`))
		boot(withItems([nativeSlot]))
		for (const card of cards) {
			screen().show(card)
		}
		vi.advanceTimersByTime(1000)

		expect(postedHits()).toHaveLength(1)
		expect(postedHits()[0]?.impressions).toHaveLength(50)
	})

	it('watches nothing while the native slot is pending, and starts once it opens', () => {
		offerCard()
		const tracker = boot(withItems([{ ...nativeSlot, gated: true }]))
		expect(ScreenObserver.latest).toBeNull()

		tracker.setGate(true)
		expect(screen().observed.size).toBe(1)
	})

	it('watches nothing at all with only vendor slots, which never receive a view', () => {
		offerCard()
		boot(withItems([{ ...posthogSlot, gated: false }]))
		expect(ScreenObserver.latest).toBeNull()
	})

	it('stops watching when the browser is excluded', () => {
		offerCard()
		const tracker = boot(withItems([nativeSlot]))
		expect(screen().observed.size).toBe(1)

		tracker.exclude(true)
		expect(screen().observed.size).toBe(0)
	})

	it('never queues the items seen for a pending slot', () => {
		vi.useFakeTimers()
		const card = offerCard()
		const tracker = boot(withItems([nativeSlot, { ...nativeSlot, slot: 'tenant', gated: true }]))
		screen().show(card)
		vi.advanceTimersByTime(1000)
		tracker.flush()
		tracker.setGate({ tenant: true })

		const engagements = posted().filter((event) => event.type === 'engagement')
		expect(engagements.map((event) => event.impressions)).toEqual([['offers:1'], undefined])
		expect(engagements[1]?.durationMs).toBe(1000)
	})
})

describe('a host without a window', () => {
	it('returns a tracker that does nothing', () => {
		vi.stubGlobal('window', undefined)
		const tracker = createTracker(configWith([nativeSlot]))
		vi.unstubAllGlobals()
		expect(() => {
			tracker.page()
			tracker.track('signup')
			tracker.trackGoal('checkout')
			tracker.setGate(true)
			tracker.exclude(true)
			tracker.flush()
			tracker.destroy()
		}).not.toThrow()
		expect(tracker.excluded).toBe(false)
		expect(tracker.gate).toEqual({ global: 'pending', tenant: 'pending' })
	})
})

describe('pages nobody should count', () => {
	const webdriver = (value: boolean) => {
		Object.defineProperty(window.navigator, 'webdriver', { value, configurable: true })
	}

	afterEach(() => {
		Reflect.deleteProperty(window.navigator, 'webdriver')
	})

	it('sends and injects nothing in a browser driven by automation, unless the install counts it', () => {
		webdriver(true)
		const skipped = boot(configWith([nativeSlot, { ...plausibleSlot, slot: 'tenant' }]))
		skipped.track('signup')
		skipped.page()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(loadScript).not.toHaveBeenCalled()

		const counted = boot(configWith([nativeSlot], { skip: { automation: false, previews: true } }))
		counted.track('signup')
		expect(posted().map((event) => event.type)).toEqual(['pageview', 'event'])
	})

	it('sends nothing on a page the server rendered in draft mode, unless previews are counted', () => {
		boot(configWith([nativeSlot], { draft: true })).track('signup')
		expect(fetchMock).not.toHaveBeenCalled()

		boot(configWith([nativeSlot], { draft: true, skip: { automation: true, previews: false } }))
		expect(posted().map((event) => event.type)).toEqual(['pageview'])
	})

	it('still takes the exclusion link out of the address of a page it does not count', () => {
		webdriver(true)
		window.history.replaceState(null, '', '/pricing?analytics_exclude=tok&utm_source=x')
		Reflect.set(window, EXCLUSION_STASH_KEY, 'tok')
		boot(configWith([nativeSlot], { exclusion: { param: 'analytics_exclude', tokenHash: 'x' } }))

		expect(window.location.search).toBe('?utm_source=x')
		expect(Reflect.get(window, EXCLUSION_STASH_KEY)).toBeUndefined()
	})
})

describe('a page shown by another window', () => {
	const ADMIN = { path: publicDigest('/admin') }

	const shownBy = (pathname: string) => {
		Object.defineProperty(window, 'opener', {
			value: { location: { origin: window.location.origin, pathname } },
			configurable: true,
		})
	}

	afterEach(() => {
		Reflect.deleteProperty(window, 'opener')
	})

	it('holds everything while it checks, then sends and injects nothing in the live preview', async () => {
		shownBy('/admin/collections/pages/1')
		const tracker = boot(
			configWith([nativeSlot, { ...plausibleSlot, slot: 'tenant' }], { admin: ADMIN })
		)
		tracker.track('while-checking')
		expect(fetchMock).not.toHaveBeenCalled()

		await new Promise((resolve) => setTimeout(resolve, 20))
		tracker.track('after')
		tracker.page()
		tracker.flush()

		expect(fetchMock).not.toHaveBeenCalled()
		expect(loadScript).not.toHaveBeenCalled()
	})

	it('still answers the gate in the live preview', async () => {
		shownBy('/admin/collections/pages/1')
		const tracker = boot(configWith([{ ...nativeSlot, gated: true }], { admin: ADMIN }))
		await new Promise((resolve) => setTimeout(resolve, 20))

		tracker.setGate(true)

		expect(tracker.gate.global).toBe('open')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('delivers what it held, after the pageview, once the window showing it is not the admin', async () => {
		shownBy('/blog/embed')
		const tracker = boot(configWith([nativeSlot], { admin: ADMIN }))
		tracker.track('early')
		expect(fetchMock).not.toHaveBeenCalled()

		await vi.waitFor(() => {
			expect(posted().map((event) => event.name ?? event.type)).toEqual(['pageview', 'early'])
		})
	})

	it('holds nothing for a page nothing shows, or while previews are counted', () => {
		boot(configWith([nativeSlot], { admin: ADMIN }))
		expect(posted().map((event) => event.type)).toEqual(['pageview'])

		shownBy('/admin/collections/pages/1')
		fetchMock.mockClear()
		boot(configWith([nativeSlot], { admin: ADMIN, skip: { automation: true, previews: false } }))
		expect(posted().map((event) => event.type)).toEqual(['pageview'])
	})
})

describe('putting a browser back', () => {
	const gatedPosthog: TrackerSlotConfig = posthogSlot

	it('never opts a pending slot in through the =0 link, and stores nothing for it', () => {
		window.history.replaceState(null, '', '/pricing?analytics_exclude=0')
		const tracker = boot(
			configWith([gatedPosthog], {
				exclusion: { param: 'analytics_exclude', tokenHash: 'a'.repeat(64) },
			}),
			{ snippets: false }
		)

		expect(tracker.gate.tenant).toBe('pending')
		expect(optIn).not.toHaveBeenCalled()
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
		window.history.replaceState(null, '', '/pricing')
	})

	it('never opts a pending or a closed slot in through exclude(false)', () => {
		const pending = boot(configWith([gatedPosthog]), { snippets: false })
		pending.exclude(false)
		expect(pending.gate.tenant).toBe('pending')

		const closed = boot(configWith([gatedPosthog]), { snippets: false, gate: false })
		closed.exclude(false)
		expect(closed.gate.tenant).toBe('closed')

		expect(optIn).not.toHaveBeenCalled()
	})

	it('clears the switch of an open slot alone', () => {
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		window.localStorage.setItem(UMAMI_DISABLED_KEY, '1')
		const tracker = boot(configWith([plausibleSlot, { ...umamiSlot, slot: 'tenant', gated: true }]))

		tracker.exclude(false)

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
		expect(window.localStorage.getItem(UMAMI_DISABLED_KEY)).toBe('1')
	})
})

describe("lifting PostHog's opt-out when its own snippet defines the global", () => {
	/** A loader standing in for the snippet: the global exists only once it has run. */
	const definingLoader = (): { load: LoadScript; run: () => void } => {
		let release: () => void = () => undefined
		const ran = new Promise<void>((resolve) => {
			release = resolve
		})
		return {
			load: () =>
				ran.then(() => {
					Object.defineProperty(window, 'posthog', {
						value: { capture, opt_out_capturing: optOut, opt_in_capturing: optIn },
						configurable: true,
					})
				}),
			run: () => release(),
		}
	}

	beforeEach(() => {
		Reflect.deleteProperty(window, 'posthog')
	})

	it('lifts it once the gated slot it opened has loaded, so a later grant is honoured', async () => {
		const loader = definingLoader()
		const tracker = createTracker(configWith([posthogSlot]), { window, loadScript: loader.load })
		trackers.push(tracker)
		tracker.setGate(true)
		expect(optIn).not.toHaveBeenCalled()

		loader.run()

		await vi.waitFor(() => {
			expect(optIn).toHaveBeenCalledWith({ captureEventName: false })
		})
		expect(optIn).toHaveBeenCalledTimes(1)
	})

	it('lifts it for an ungated slot the tracker injects, opened by name', async () => {
		const loader = definingLoader()
		const tracker = createTracker(configWith([{ ...posthogSlot, gated: false }]), {
			window,
			loadScript: loader.load,
		})
		trackers.push(tracker)
		tracker.setGate({ tenant: true })
		loader.run()

		await vi.waitFor(() => {
			expect(optIn).toHaveBeenCalledTimes(1)
		})
	})

	it('lifts nothing on a boot that opened nothing explicitly', async () => {
		const loader = definingLoader()
		trackers.push(
			createTracker(configWith([{ ...posthogSlot, gated: false }]), {
				window,
				loadScript: loader.load,
			})
		)
		loader.run()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(optIn).not.toHaveBeenCalled()
	})

	it('lifts nothing once the slot closed, or the browser was excluded, before the script ran', async () => {
		const closing = definingLoader()
		const closed = createTracker(configWith([posthogSlot]), { window, loadScript: closing.load })
		trackers.push(closed)
		closed.setGate(true)
		closed.setGate(false)
		closing.run()

		const excluding = definingLoader()
		const excluded = createTracker(configWith([posthogSlot]), {
			window,
			loadScript: excluding.load,
		})
		trackers.push(excluded)
		excluded.setGate(true)
		excluded.exclude(true)
		excluding.run()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(optIn).not.toHaveBeenCalled()
	})
})

describe('closing a GA4 slot whose tag already ran', () => {
	let gtag: ReturnType<typeof vi.fn>

	beforeEach(() => {
		gtag = vi.fn()
		Object.defineProperty(window, 'gtag', { value: gtag, configurable: true })
		Reflect.set(window, 'dataLayer', [])
	})

	afterEach(() => {
		Reflect.deleteProperty(window, 'gtag')
		Reflect.deleteProperty(window, 'dataLayer')
	})

	/** What the rendered snippet leaves in the `dataLayer`: array-like `arguments`, not arrays. */
	const configured = (id: string) => {
		const layer: unknown = Reflect.get(window, 'dataLayer')
		if (Array.isArray(layer)) {
			layer.push({ 0: 'config', 1: id, length: 2 })
		}
	}

	it('denies every storage type through consent mode, beside the disable switch', () => {
		configured('G-TEST')
		const tracker = boot(configWith([ga4Slot]))

		tracker.setGate({ global: false })

		expect(Reflect.get(window, `${GA4_DISABLE_PREFIX}G-TEST`)).toBe(true)
		expect(gtag).toHaveBeenCalledWith('consent', 'update', {
			analytics_storage: 'denied',
			ad_storage: 'denied',
			ad_user_data: 'denied',
			ad_personalization: 'denied',
		})
	})

	it('grants nothing back when the slot opens again on the same page', () => {
		configured('G-TEST')
		const tracker = boot(configWith([ga4Slot]))
		tracker.setGate({ global: false })
		gtag.mockClear()

		tracker.setGate({ global: true })

		expect(Reflect.get(window, `${GA4_DISABLE_PREFIX}G-TEST`)).toBe(false)
		expect(gtag.mock.calls.filter((call) => call[0] === 'consent')).toEqual([])
	})

	it("leaves another tag's consent alone when this measurement id never ran", () => {
		configured('AW-ADS')
		boot(configWith([ga4Slot])).setGate({ global: false })

		expect(gtag.mock.calls.filter((call) => call[0] === 'consent')).toEqual([])
	})

	it('denies it on a refusal of a tag the host loads itself', () => {
		configured('G-TEST')
		boot(configWith([{ ...ga4Slot, gated: true }]), { snippets: false }).setGate(false)

		expect(gtag).toHaveBeenCalledWith(
			'consent',
			'update',
			expect.objectContaining({ analytics_storage: 'denied' })
		)
	})
})

describe('a refusal of a vendor the host loads itself', () => {
	it('writes the switch, since the host may have run that vendor', () => {
		boot(configWith([{ ...plausibleSlot, gated: true }]), { snippets: false }).setGate(false)

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
	})
})

describe('a destroyed tracker', () => {
	it('sends nothing more and loads nothing, whatever it is told', async () => {
		const tracker = boot(configWith([{ ...nativeSlot, gated: true }, posthogSlot]))
		tracker.setGate(true)
		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		tracker.destroy()
		fetchMock.mockClear()
		loadScript.mockClear()

		tracker.setGate(false)
		tracker.track('after-destroy')
		tracker.trackGoal('checkout')
		tracker.purchase({ value: 5 })
		tracker.page()
		tracker.flush()
		tracker.exclude(false)
		await Promise.resolve()

		expect(fetchMock).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
		expect(loadScript).not.toHaveBeenCalled()
	})

	it('still persists the exclusion it is asked for, touching no vendor', () => {
		const tracker = boot(configWith([plausibleSlot]))
		tracker.destroy()

		tracker.exclude(true)

		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBe('1')
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
	})
})

describe('the gate of a page nobody counts', () => {
	afterEach(() => {
		Reflect.deleteProperty(window.navigator, 'webdriver')
	})

	it('takes the answers a counted page would, from boot and afterwards', () => {
		Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true })
		const tracker = boot(configWith([nativeSlot, posthogSlot]), { gate: { tenant: false } })
		expect(tracker.gate).toEqual({ global: 'open', tenant: 'closed' })

		tracker.setGate({ tenant: true })

		expect(tracker.gate).toEqual({ global: 'open', tenant: 'open' })
		expect(fetchMock).not.toHaveBeenCalled()
		expect(loadScript).not.toHaveBeenCalled()
	})
})

describe('storage before a slot opens', () => {
	const LINK = { param: 'analytics_exclude', tokenHash: 'a'.repeat(64) }
	const gatedNative: TrackerSlotConfig = { ...nativeSlot, gated: true }

	/** Every call the page makes to `localStorage`, `sessionStorage` or `document.cookie`. */
	const watchStorage = () => {
		const spies = [
			...(['getItem', 'setItem', 'removeItem', 'key', 'clear'] as const).map((method) =>
				vi.spyOn(Storage.prototype, method)
			),
			vi.spyOn(Document.prototype, 'cookie', 'get'),
			vi.spyOn(Document.prototype, 'cookie', 'set'),
		]
		return {
			count: () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0),
			restore: () => {
				for (const spy of spies) {
					spy.mockRestore()
				}
			},
		}
	}

	afterEach(() => {
		window.history.replaceState(null, '', '/pricing')
	})

	it('touches no storage while every slot is pending, whatever the page does', async () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		window.localStorage.setItem('analytics:consent', 'granted')
		window.history.replaceState(null, '', '/pricing?utm_source=x')
		const storage = watchStorage()

		const tracker = boot(
			configWith([gatedNative, { ...umamiSlot, slot: 'tenant', gated: true }], { exclusion: LINK })
		)
		tracker.track('signup')
		tracker.trackGoal('checkout')
		tracker.purchase({ value: 5, orderId: 'o-1' })
		window.history.pushState(null, '', '/next')
		tracker.flush()
		hideTab()
		showTab()
		expect(tracker.excluded).toBe(false)
		await Promise.resolve()

		expect(storage.count()).toBe(0)
		expect(fetchMock).not.toHaveBeenCalled()
		expect(loadScript).not.toHaveBeenCalled()
		storage.restore()
	})

	it('reads the flag when the first slot opens, and drops what waited when it is set', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		const tracker = boot(configWith([gatedNative]))
		tracker.track('signup')
		expect(tracker.excluded).toBe(false)

		tracker.setGate(true)

		expect(tracker.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()
		tracker.track('later')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('reads nothing on a refusal', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		const storage = watchStorage()
		const tracker = boot(configWith([gatedNative]))

		tracker.setGate(false)

		expect(storage.count()).toBe(0)
		expect(tracker.excluded).toBe(false)
		storage.restore()
	})

	it('puts a browser back through =0 at once, and sends nothing before a slot opens', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		window.history.replaceState(null, '', '/pricing?analytics_exclude=0')
		const tracker = boot(configWith([gatedNative], { exclusion: LINK }))
		tracker.track('signup')

		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
		expect(tracker.excluded).toBe(false)
		expect(window.location.search).toBe('')
		expect(fetchMock).not.toHaveBeenCalled()

		tracker.setGate(true)

		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
		expect(posted().map((event) => event.name ?? event.type)).toEqual(['pageview', 'signup'])
	})

	it('writes nothing through =0 on a browser that was not excluded', () => {
		window.history.replaceState(null, '', '/pricing?analytics_exclude=0')
		const storage = watchStorage()
		boot(configWith([gatedNative], { exclusion: LINK }))

		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
		expect(Storage.prototype.setItem).not.toHaveBeenCalled()
		expect(Storage.prototype.removeItem).not.toHaveBeenCalled()
		storage.restore()
	})

	// Anyone can link to `?analytics_exclude=0`; only a browser that was excluded has switches to lift.
	it('clears no vendor switch through =0 on a browser that was not excluded', () => {
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		window.history.replaceState(null, '', '/pricing?analytics_exclude=0')

		boot(configWith([plausibleSlot, { ...posthogSlot, gated: false }], { exclusion: LINK }))

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
		expect(optIn).not.toHaveBeenCalled()
	})

	it('clears the switches its exclusion set through =0', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		window.history.replaceState(null, '', '/pricing?analytics_exclude=0')

		boot(configWith([plausibleSlot], { exclusion: LINK }))

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBeNull()
	})
})

describe('how long an event waited', () => {
	const gatedNative: TrackerSlotConfig = { ...nativeSlot, gated: true }

	it('stamps the wait on what a pending gate held, and nothing on what is sent at once', () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([gatedNative]))
		vi.advanceTimersByTime(5000)
		tracker.track('held')
		vi.advanceTimersByTime(3000)

		tracker.setGate(true)
		tracker.track('direct')

		expect(posted().map((event) => [event.name ?? event.type, event.ageMs])).toEqual([
			['pageview', 8000],
			['held', 3000],
			['direct', undefined],
		])
	})

	it('lets ingest file a held engagement at its held pageview start', () => {
		vi.useFakeTimers()
		const tracker = boot(configWith([gatedNative]))
		vi.advanceTimersByTime(4000)
		hideTab()
		vi.advanceTimersByTime(6000)

		tracker.setGate(true)

		const [pageview, engagement] = posted()
		expect(engagement?.type).toBe('engagement')
		const startOf = (event: TrackerEvent | undefined) =>
			(event?.ageMs ?? 0) + (event?.type === 'engagement' ? (event.sinceMs ?? 0) : 0)
		expect(startOf(pageview)).toBe(10_000)
		expect(startOf(engagement)).toBe(startOf(pageview))
	})
})

describe('a page restored from the back/forward cache', () => {
	const gatedNative: TrackerSlotConfig = { ...nativeSlot, gated: true }

	const restore = (persisted = true) => {
		window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }))
	}

	it('holds its gated slots until the host answers again, queueing what is sent meanwhile', () => {
		const tracker = boot(configWith([gatedNative, { ...posthogSlot, gated: false }]))
		tracker.setGate(true)
		tracker.track('before')

		restore()
		tracker.track('restored')

		expect(tracker.gate).toEqual({ global: 'pending', tenant: 'open' })
		expect(postedHits().map((event) => event.name)).toEqual(['before'])

		tracker.setGate(true)

		expect(postedHits().map((event) => event.name)).toEqual(['before', 'restored'])
	})

	it('drops what waited when the host refuses after the restore', () => {
		const tracker = boot(configWith([gatedNative]))
		tracker.setGate(true)
		restore()
		tracker.track('restored')

		tracker.setGate(false)

		expect(postedHits()).toEqual([])
		expect(tracker.gate.global).toBe('closed')
	})

	it('sets the vendor switch on a refusal after the restore, since its script ran', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.setGate(true)
		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		restore()

		tracker.setGate(false)

		expect(optOut).toHaveBeenCalledTimes(1)
	})

	it('changes nothing for a page shown without a restore', () => {
		const tracker = boot(configWith([gatedNative]))
		tracker.setGate(true)

		restore(false)

		expect(tracker.gate.global).toBe('open')
	})
})
