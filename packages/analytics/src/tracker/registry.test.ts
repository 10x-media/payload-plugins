import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from './config'
import type { TrackerLease } from './registry'
import {
	acquireTracker,
	forgetWindowGate,
	liveTracker,
	setWindowGate,
	subscribeWindowGate,
	windowGateSnapshot,
} from './registry'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const nativeSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'native',
	adapterId: 'native',
	path: '/api/_x/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	gated: false,
}

const config: TrackerConfig = {
	slots: [nativeSlot],
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
		query: false,
		items: { impressions: false, clicks: false, pages: false },
	},
	goals: [],
	ingestPath: '/api/_x/e',
}

const leases: TrackerLease[] = []

const acquire = (): TrackerLease => {
	const lease = acquireTracker(config, { window })
	leases.push(lease)
	return lease
}

/** Lets the deferred teardown macrotask run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
})

afterEach(async () => {
	while (leases.length > 0) {
		leases.pop()?.release()
	}
	await settle()
	forgetWindowGate(window)
})

describe('acquireTracker', () => {
	it('boots one tracker for a window, however many holders it has', () => {
		const first = acquire()
		const second = acquire()

		expect(second.tracker).toBe(first.tracker)
		window.dispatchEvent(new Event('pagehide'))
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('keeps the tracker alive while any holder remains', async () => {
		const first = acquire()
		const second = acquire()
		first.release()
		await settle()

		window.dispatchEvent(new Event('pagehide'))
		expect(fetchMock).toHaveBeenCalledTimes(1)
		second.release()
	})

	it('destroys on the macrotask after the last release', async () => {
		acquire().release()
		expect(fetchMock).toHaveBeenCalledTimes(1)

		await settle()

		window.history.pushState(null, '', '/after-teardown')
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('survives a release followed by a synchronous re-acquire', async () => {
		const first = acquire()
		first.release()
		const second = acquire()

		await settle()

		expect(second.tracker).toBe(first.tracker)
		window.history.pushState(null, '', '/still-tracked')
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('ignores a second release from the same holder', async () => {
		const first = acquire()
		const second = acquire()
		first.release()
		first.release()
		await settle()

		window.dispatchEvent(new Event('pagehide'))
		expect(fetchMock).toHaveBeenCalledTimes(1)
		second.release()
	})

	it('boots a fresh tracker after the previous one was torn down', async () => {
		acquire().release()
		await settle()
		fetchMock.mockClear()

		acquire()

		window.dispatchEvent(new Event('pagehide'))
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('hands back a tracker that does nothing when there is no window', () => {
		vi.stubGlobal('window', undefined)
		const lease = acquireTracker(config)
		vi.unstubAllGlobals()

		expect(() => {
			lease.tracker.track('signup')
			lease.release()
		}).not.toThrow()
	})
})

describe('the window gate', () => {
	const gatedConfig: TrackerConfig = { ...config, slots: [{ ...nativeSlot, gated: true }] }

	const acquireGated = (): TrackerLease => {
		const lease = acquireTracker(gatedConfig, { window })
		leases.push(lease)
		return lease
	}

	it('keeps an answer given before any tracker exists, and applies it at boot', () => {
		expect(liveTracker(window)).toBeNull()
		setWindowGate(true, window)
		expect(windowGateSnapshot(window)).toEqual({ global: 'open', tenant: 'open' })

		const { tracker } = acquireGated()

		expect(tracker.gate.global).toBe('open')
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("applies the holder's own boot answer first and the window's answers after it", () => {
		setWindowGate({ global: false }, window)
		const lease = acquireTracker(gatedConfig, { window, gate: { global: true } })
		leases.push(lease)

		expect(lease.tracker.gate.global).toBe('closed')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('hands a later answer to the live tracker and to every tracker booted after it', async () => {
		acquireGated().release()
		setWindowGate(true, window)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		await settle()

		const { tracker } = acquireGated()
		expect(tracker.gate.global).toBe('open')
	})

	it('tells subscribers when the gate may have changed, and stops once unsubscribed', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeWindowGate(listener, window)
		setWindowGate(true, window)
		acquireGated()
		expect(listener).toHaveBeenCalledTimes(2)

		unsubscribe()
		setWindowGate(false, window)
		expect(listener).toHaveBeenCalledTimes(2)
	})

	it('reads pending for every slot with no answer and no tracker', () => {
		expect(windowGateSnapshot(window)).toEqual({ global: 'pending', tenant: 'pending' })
	})

	it('reads the live tracker gate once one exists', () => {
		const { tracker } = acquireGated()
		expect(windowGateSnapshot(window)).toBe(tracker.gate)
	})

	// Before any config, a refusal would close a held slot and leave an ungated one open.
	it('reads a refusal given before any boot as pending, since which slots wait is not known', () => {
		setWindowGate(false, window)
		expect(windowGateSnapshot(window)).toEqual({ global: 'pending', tenant: 'pending' })
	})

	it("reads the answers against the window's config once a tracker booted, after its teardown too", async () => {
		acquire().release()
		await settle()

		setWindowGate(false, window)

		expect(liveTracker(window)).toBeNull()
		expect(windowGateSnapshot(window)).toEqual({ global: 'open', tenant: 'closed' })
	})

	it('forgets its held answers when the back/forward cache restores the page, and says so', async () => {
		const listener = vi.fn()
		subscribeWindowGate(listener, window)
		setWindowGate(true, window)
		const { tracker } = acquireGated()
		listener.mockClear()

		window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

		expect(listener).toHaveBeenCalledTimes(1)
		expect(windowGateSnapshot(window).global).toBe('pending')
		expect(tracker.gate.global).toBe('pending')
		leases.pop()?.release()
		await settle()
		expect(acquireGated().tracker.gate.global).toBe('pending')
	})

	it('keeps a named answer for an ungated slot across a restore', () => {
		setWindowGate({ global: false }, window)
		const { tracker } = acquire()
		expect(tracker.gate.global).toBe('closed')

		window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

		expect(windowGateSnapshot(window).global).toBe('closed')
	})

	it('reports the answers on a page it does not count', () => {
		Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true })
		const { tracker } = acquireGated()
		setWindowGate(true, window)
		Reflect.deleteProperty(window.navigator, 'webdriver')

		expect(tracker.gate.global).toBe('open')
		expect(windowGateSnapshot(window)).toEqual({ global: 'open', tenant: 'closed' })
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
