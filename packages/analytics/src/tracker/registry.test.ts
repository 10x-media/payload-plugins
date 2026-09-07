import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
import type { TrackerLease } from './registry'
import { acquireTracker } from './registry'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const nativeSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'native',
	adapterId: 'native',
	path: '/api/analytics/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	requiresConsent: false,
}

const config: TrackerConfig = {
	slots: [nativeSlot],
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
	},
	goals: [],
	ingestPath: '/api/analytics/ingest',
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
		expect(fetchMock).not.toHaveBeenCalled()

		await settle()

		// Destroy flushes the buffered boot pageview, then detaches every listener.
		expect(fetchMock).toHaveBeenCalledTimes(1)
		window.dispatchEvent(new Event('pagehide'))
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('survives a release followed by a synchronous re-acquire', async () => {
		const first = acquire()
		first.release()
		const second = acquire()

		await settle()

		expect(second.tracker).toBe(first.tracker)
		expect(fetchMock).not.toHaveBeenCalled()
		window.dispatchEvent(new Event('pagehide'))
		expect(fetchMock).toHaveBeenCalledTimes(1)
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
