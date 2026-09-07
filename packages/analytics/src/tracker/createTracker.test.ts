import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
import { CONSENT_QUEUE_LIMIT, CONSENT_STORAGE_KEY } from './consent'
import { createTracker } from './createTracker'
import type { LoadScript, Tracker, TrackerEvent } from './types'

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
	},
	goals: [],
	ingestPath: '/api/analytics/ingest',
	...extra,
})

let capture: ReturnType<typeof vi.fn>
let loadScript: ReturnType<typeof vi.fn> & LoadScript
let trackers: Tracker[]

const boot = (config: TrackerConfig, options: { persistConsent?: boolean } = {}): Tracker => {
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
	Object.defineProperty(window, 'posthog', { value: { capture }, configurable: true })
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
			tracker.flush()
			tracker.destroy()
		}).not.toThrow()
	})
})
