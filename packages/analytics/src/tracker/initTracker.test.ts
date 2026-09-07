import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig } from '../capture/trackerConfig'
import { DEFAULT_TRACKER_ENDPOINT, initTracker } from './initTracker'
import type { Tracker } from './types'

const config: TrackerConfig = {
	slots: [],
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
	},
	goals: [],
	ingestPath: '/api/analytics/ingest',
}

const fetchMock = vi.fn()
let tracker: Tracker | null = null

beforeEach(() => {
	fetchMock.mockReset()
	window.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
	tracker?.destroy()
	tracker = null
})

describe('initTracker', () => {
	it('fetches the config from the default endpoint with same-origin credentials', async () => {
		fetchMock.mockResolvedValue(Response.json(config))
		tracker = await initTracker({ window })

		expect(fetchMock).toHaveBeenCalledWith(DEFAULT_TRACKER_ENDPOINT, {
			credentials: 'same-origin',
		})
		expect(DEFAULT_TRACKER_ENDPOINT).toBe('/api/analytics/tracker')
	})

	it('honours a custom endpoint', async () => {
		fetchMock.mockResolvedValue(Response.json(config))
		tracker = await initTracker({ window, endpoint: '/t/config' })

		expect(fetchMock).toHaveBeenCalledWith('/t/config', { credentials: 'same-origin' })
	})

	it('degrades to a tracker that does nothing when the config cannot be fetched', async () => {
		fetchMock.mockRejectedValue(new Error('offline'))
		tracker = await initTracker({ window })

		expect(() => tracker?.track('signup')).not.toThrow()
	})

	it('degrades the same way on a non-ok response', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
		tracker = await initTracker({ window })

		expect(() => tracker?.track('signup')).not.toThrow()
	})
})
