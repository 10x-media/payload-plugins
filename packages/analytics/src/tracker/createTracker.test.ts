import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
import { MAX_QUERY_LENGTH } from '../query/limits'
import { CONSENT_QUEUE_LIMIT, CONSENT_STORAGE_KEY } from './consent'
import { createTracker } from './createTracker'
import { EXCLUSION_STORAGE_KEY } from './exclusion'
import { GA4_DISABLE_PREFIX } from './sinks/ga4'
import { PLAUSIBLE_IGNORE_KEY } from './sinks/plausible'
import { UMAMI_DISABLED_KEY } from './sinks/umami'
import type { LoadScript, Tracker, TrackerEvent, TrackerOptions } from './types'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const posted = (): Array<TrackerEvent & { url: string }> =>
	fetchMock.mock.calls.map((call) => {
		const [url, init] = call as unknown as [string, RequestInit]
		return { url, ...(JSON.parse(init.body as string) as TrackerEvent) }
	})

const nativeSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'native',
	adapterId: 'native',
	path: '/api/analytics/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	requiresConsent: false,
}

const posthogSlot: TrackerSlotConfig = {
	slot: 'tenant',
	kind: 'posthog',
	adapterId: 'posthog',
	path: '/api/analytics/p/tenant',
	snippet: { scripts: [{ src: '/api/analytics/p/tenant/static/array.js' }] },
	client: { kind: 'posthog', token: 'tok' },
	requiresConsent: true,
}

const plausibleSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'plausible',
	adapterId: 'plausible',
	path: '/api/analytics/p/global',
	snippet: { scripts: [{ src: '/api/analytics/p/global/js/script.js' }] },
	client: { kind: 'plausible' },
	requiresConsent: false,
}

const umamiSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'umami',
	adapterId: 'umami',
	path: '/api/analytics/p/global',
	snippet: { scripts: [{ src: '/api/analytics/p/global/script.js' }] },
	client: { kind: 'umami' },
	requiresConsent: false,
}

const ga4Slot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'ga4',
	adapterId: 'ga4',
	path: '/api/analytics/p/global',
	snippet: { scripts: [{ src: '/api/analytics/p/global/gtag/js' }] },
	client: { kind: 'ga4', measurementId: 'G-TEST' },
	requiresConsent: false,
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
	},
	goals: [],
	ingestPath: '/api/analytics/ingest',
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
	vi.useRealTimers()
})

describe('page tracking', () => {
	it('buffers the boot pageview and sends it on flush', () => {
		const tracker = boot(configWith([nativeSlot]))
		expect(fetchMock).not.toHaveBeenCalled()

		tracker.flush()

		expect(posted()).toEqual([
			{
				url: '/api/analytics/ingest',
				type: 'pageview',
				path: '/pricing',
				hostname: 'localhost',
				durationMs: expect.any(Number),
			},
		])
	})

	it('flushes the previous pageview on an SPA navigation', () => {
		boot(configWith([nativeSlot]))
		window.history.pushState(null, '', '/checkout')

		expect(posted()).toHaveLength(1)
		expect(posted()[0]?.path).toBe('/pricing')
	})

	it('flushes on pagehide', () => {
		boot(configWith([nativeSlot]))
		window.dispatchEvent(new Event('pagehide'))

		expect(posted()).toHaveLength(1)
		expect(posted()[0]?.type).toBe('pageview')
	})

	it('carries the referrer when the document has one', () => {
		Object.defineProperty(document, 'referrer', {
			value: 'https://google.com/',
			configurable: true,
		})
		boot(configWith([nativeSlot])).flush()

		expect(posted()[0]?.referrer).toBe('https://google.com/')
		Object.defineProperty(document, 'referrer', { value: '', configurable: true })
	})
})

describe('query string capture', () => {
	it('carries the query, without its leading question mark, on a pageview', () => {
		window.history.replaceState(null, '', '/pricing?utm_source=newsletter&page=2')
		boot(configWith([nativeSlot])).flush()

		expect(posted()[0]?.query).toBe('utm_source=newsletter&page=2')
		expect(posted()[0]?.path).toBe('/pricing')
	})

	it('omits the query on a page with none', () => {
		boot(configWith([nativeSlot])).flush()

		expect(posted()[0]).not.toHaveProperty('query')
	})

	it('never carries the query on an event or a goal', () => {
		window.history.replaceState(null, '', '/pricing?utm_source=newsletter')
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('signup')
		tracker.trackGoal('checkout')

		expect(posted()[0]).not.toHaveProperty('query')
		expect(posted()[1]).not.toHaveProperty('query')
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
				},
			})
		).flush()

		expect(posted()[0]).not.toHaveProperty('query')
	})

	it('caps the query it sends', () => {
		window.history.replaceState(null, '', `/pricing?pad=${'x'.repeat(MAX_QUERY_LENGTH)}`)
		boot(configWith([nativeSlot])).flush()

		expect(posted()[0]?.query).toHaveLength(MAX_QUERY_LENGTH)
	})
})

describe('track and trackGoal', () => {
	it('sends an event immediately, with its props', () => {
		boot(configWith([nativeSlot])).track('signup', { plan: 'pro' })

		expect(posted()[0]).toMatchObject({
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

		expect(posted()[0]).toMatchObject({
			type: 'goal',
			name: 'checkout',
			value: 49,
			currency: 'EUR',
		})
		expect(posted()[1]).toMatchObject({ value: 99, currency: 'USD' })
	})

	it('sends a goal the config snapshot does not know', () => {
		boot(configWith([nativeSlot])).trackGoal('newsletter')

		expect(posted()[0]).toMatchObject({ type: 'goal', name: 'newsletter' })
		expect(posted()[0]).not.toHaveProperty('value')
	})
})

describe('consent', () => {
	it('queues events for a gated slot and never loads its script', () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('signup')

		expect(loadScript).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
	})

	it('drains the queue in order once consent is granted', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('first')
		tracker.track('second')
		tracker.consent('granted')

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(2)
		})
		expect(capture.mock.calls.map((call) => call[0])).toEqual(['first', 'second'])
		expect(loadScript).toHaveBeenCalledTimes(1)
		expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('granted')
	})

	it('drops the queue on denial and loads nothing', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('first')
		tracker.consent('denied')
		tracker.track('second')
		tracker.consent('granted')

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		expect(capture).not.toHaveBeenCalled()
	})

	it('keeps only the newest events once the queue is full', async () => {
		const tracker = boot(configWith([posthogSlot]))
		for (let i = 0; i < CONSENT_QUEUE_LIMIT + 3; i += 1) {
			tracker.track(`event-${i}`)
		}
		tracker.consent('granted')

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(CONSENT_QUEUE_LIMIT)
		})
		expect(capture.mock.calls[0]?.[0]).toBe('event-3')
	})

	it('loads a gated vendor at boot when consent was already granted', async () => {
		window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('signup')

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
			expect(capture).toHaveBeenCalledWith('signup', {})
		})
	})

	it('neither reads nor writes storage when persistence is off', async () => {
		window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
		const tracker = boot(configWith([posthogSlot]), { persistConsent: false })
		tracker.track('signup')
		expect(loadScript).not.toHaveBeenCalled()

		tracker.consent('granted')

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledWith('signup', {})
		})
		expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('denied')
	})

	it('never gates a slot the server did not gate', () => {
		boot(configWith([nativeSlot])).track('signup')

		expect(posted()).toHaveLength(1)
	})
})

describe('fan-out and teardown', () => {
	it('sends one event to every slot', async () => {
		const tracker = boot(configWith([nativeSlot, { ...posthogSlot, requiresConsent: false }]))
		tracker.track('signup')

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledWith('signup', {})
		})
		expect(posted()).toHaveLength(1)
	})

	it('flushes and detaches on destroy', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.destroy()
		expect(posted()).toHaveLength(1)

		window.history.pushState(null, '', '/after')
		window.dispatchEvent(new Event('pagehide'))
		expect(posted()).toHaveLength(1)
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
		const tracker = boot(configWith([nativeSlot, { ...posthogSlot, requiresConsent: false }]))
		tracker.track('warmup')
		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(1)
		})

		expect(() => tracker.track('signup', cyclic())).not.toThrow()

		expect(capture).toHaveBeenCalledTimes(2)
		expect(capture.mock.calls[1]?.[0]).toBe('signup')
	})

	it('keeps flushing later slots when one flush throws', () => {
		const original = Object.getOwnPropertyDescriptor(
			window.Element.prototype,
			'scrollHeight'
		) as PropertyDescriptor
		let firstRead = true
		Object.defineProperty(document.documentElement, 'scrollHeight', {
			configurable: true,
			get() {
				if (firstRead) {
					firstRead = false
					throw new Error('layout is gone')
				}
				return 1000
			},
		})
		const tracker = boot(
			configWith([nativeSlot, { ...nativeSlot, slot: 'tenant' }], {
				autoCapture: {
					scrollDepth: true,
					outboundLinks: false,
					fileDownloads: false,
					goalAttribute: false,
					query: true,
				},
			})
		)

		expect(() => tracker.flush()).not.toThrow()

		expect(posted()).toHaveLength(1)
		Object.defineProperty(document.documentElement, 'scrollHeight', original)
	})

	it('keeps draining the consent queue when one queued send throws', async () => {
		const tracker = boot(configWith([{ ...nativeSlot, requiresConsent: true }, posthogSlot]))
		tracker.track('signup', cyclic())

		expect(() => tracker.consent('granted')).not.toThrow()

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(1)
		})
		expect(capture.mock.calls[0]?.[0]).toBe('signup')
	})
})

describe('staff exclusion', () => {
	const openWith = (search: string) => {
		window.history.replaceState(null, '', `/pricing${search}`)
	}

	it('delivers nothing and loads nothing on a page opened with the parameter', async () => {
		openWith('?analytics_exclude=1')
		const tracker = boot(configWith([nativeSlot, { ...posthogSlot, requiresConsent: false }]))
		tracker.track('signup')
		tracker.trackGoal('checkout')
		tracker.flush()
		await Promise.resolve()

		expect(tracker.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
		expect(loadScript).not.toHaveBeenCalled()
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBe('1')
	})

	it('leaves the URL alone', () => {
		openWith('?analytics_exclude=1&utm_source=newsletter')
		boot(configWith([nativeSlot]))

		expect(window.location.search).toBe('?analytics_exclude=1&utm_source=newsletter')
	})

	it('keeps the flag for the next page, and the parameter clears it again', () => {
		openWith('?analytics_exclude=1')
		expect(boot(configWith([nativeSlot])).excluded).toBe(true)

		openWith('')
		const later = boot(configWith([nativeSlot]))
		later.track('signup')
		expect(later.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()

		openWith('?analytics_exclude=0')
		const cleared = boot(configWith([nativeSlot]))
		cleared.track('signup')

		expect(cleared.excluded).toBe(false)
		expect(posted()).toHaveLength(1)
	})

	it('injects no gated vendor script even once consent is granted', async () => {
		openWith('?analytics_exclude=1')
		const tracker = boot(configWith([posthogSlot]))
		tracker.consent('granted')
		tracker.track('signup')
		await Promise.resolve()

		expect(loadScript).not.toHaveBeenCalled()
		expect(capture).not.toHaveBeenCalled()
	})

	it('queues nothing while excluded, so clearing the flag replays nothing', async () => {
		openWith('?analytics_exclude=1')
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('skipped')
		tracker.exclude(false)
		tracker.consent('granted')

		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		expect(capture).not.toHaveBeenCalled()
	})

	it('flips at runtime and resumes from then on', () => {
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('before')
		tracker.exclude(true)
		tracker.track('during')
		expect(tracker.excluded).toBe(true)

		tracker.exclude(false)
		tracker.track('after')

		expect(posted().map((event) => event.name)).toEqual(['before', 'after'])
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBe('0')
	})

	it('ignores the parameter, but honours a stored flag, when it is turned off', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		openWith('?analytics_exclude=0')
		const tracker = boot(configWith([nativeSlot]), { exclusionParam: false })
		tracker.track('signup')

		expect(tracker.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('reads the parameter name the host chose', () => {
		openWith('?staff=1')
		expect(boot(configWith([nativeSlot]), { exclusionParam: 'staff' }).excluded).toBe(true)
	})

	it('excludes this page alone when storage is blocked, and never throws', () => {
		const denied = () => {
			throw new Error('denied')
		}
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)
		openWith('?analytics_exclude=1')

		const tracker = boot(configWith([nativeSlot]))
		expect(() => tracker.track('signup')).not.toThrow()
		expect(tracker.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()

		getItem.mockRestore()
		setItem.mockRestore()
		openWith('')
		expect(boot(configWith([nativeSlot])).excluded).toBe(false)
	})

	it('sets every vendor own opt-out switch, and clears them when asked', () => {
		openWith('?analytics_exclude=1')
		const tracker = boot(
			configWith([plausibleSlot, umamiSlot, ga4Slot, { ...posthogSlot, requiresConsent: false }])
		)

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

	it('sends nothing for an auto-captured outbound click or scroll', () => {
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
		openWith('?analytics_exclude=1')

		boot(
			configWith([nativeSlot], {
				autoCapture: {
					scrollDepth: true,
					outboundLinks: true,
					fileDownloads: false,
					goalAttribute: false,
					query: true,
				},
			})
		)
		document.body.firstElementChild?.dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true })
		)
		window.dispatchEvent(new Event('scroll'))

		expect(fetchMock).not.toHaveBeenCalled()
		document.body.innerHTML = ''
		document.removeEventListener('click', swallowNavigation)
		Object.defineProperty(document.documentElement, 'scrollHeight', original)
	})

	it('sends nothing for an SPA navigation', () => {
		openWith('?analytics_exclude=1')
		boot(configWith([nativeSlot]))

		window.history.pushState(null, '', '/checkout')
		window.dispatchEvent(new Event('pagehide'))

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('empties a consent queue that already held events', async () => {
		const tracker = boot(configWith([posthogSlot]))
		tracker.track('before')
		tracker.exclude(true)
		tracker.consent('granted')
		await Promise.resolve()

		expect(capture).not.toHaveBeenCalled()
	})

	it('reads a renamed parameter whose name needs encoding', () => {
		openWith('?a.b%5B%5D=1')
		expect(boot(configWith([nativeSlot]), { exclusionParam: 'a.b[]' }).excluded).toBe(true)
	})

	it('treats a stored value that is not the flag as not excluded', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, 'yes')
		const tracker = boot(configWith([nativeSlot]))
		tracker.track('signup')

		expect(tracker.excluded).toBe(false)
		expect(posted()).toHaveLength(1)
	})

	it('never clears a vendor switch it did not set', () => {
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		window.localStorage.setItem(UMAMI_DISABLED_KEY, '1')

		boot(configWith([plausibleSlot, umamiSlot]))

		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
		expect(window.localStorage.getItem(UMAMI_DISABLED_KEY)).toBe('1')
		expect(optIn).not.toHaveBeenCalled()
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
			tracker.consent('granted')
			tracker.exclude(true)
			tracker.flush()
			tracker.destroy()
		}).not.toThrow()
		expect(tracker.excluded).toBe(false)
	})
})
