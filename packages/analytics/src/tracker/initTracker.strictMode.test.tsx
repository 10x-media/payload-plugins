import { cleanup, render } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig } from './config'
import { DEFAULT_TRACKER_ENDPOINT, initTracker } from './initTracker'
import { forgetWindowGate } from './registry'
import type { Tracker } from './types'

const config: TrackerConfig = {
	slots: [
		{
			slot: 'global',
			kind: 'native',
			adapterId: 'native',
			path: '/api/_x/p/global',
			snippet: { scripts: [] },
			client: { kind: 'native' },
			gated: false,
		},
	],
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

const fetchMock = vi.fn()

/** The config requests and the beacons, apart. */
const calls = (url: string) => fetchMock.mock.calls.filter((call) => call[0] === url)

/** A static page's boot: the tracker from the endpoint, given back on unmount. */
function StaticBoot() {
	useEffect(() => {
		let tracker: Tracker | null = null
		let unmounted = false
		void initTracker({ window }).then((booted) => {
			if (unmounted) {
				booted.destroy()
			} else {
				tracker = booted
			}
		})
		return () => {
			unmounted = true
			tracker?.destroy()
		}
	}, [])
	return null
}

beforeEach(() => {
	let configRequests = 0
	fetchMock.mockReset()
	// A second config request answers after the first lease's teardown would have run.
	fetchMock.mockImplementation((url: string) => {
		if (url !== DEFAULT_TRACKER_ENDPOINT) {
			return Promise.resolve(new Response(null, { status: 202 }))
		}
		configRequests += 1
		const delay = configRequests === 1 ? 0 : 20
		return new Promise((resolve) => setTimeout(() => resolve(Response.json(config)), delay))
	})
	window.fetch = fetchMock as unknown as typeof fetch
})

afterEach(async () => {
	cleanup()
	await new Promise((resolve) => setTimeout(resolve, 0))
	forgetWindowGate(window)
})

describe('initTracker under StrictMode', () => {
	it('fetches the config once and boots one tracker for the double mount', async () => {
		render(
			<StrictMode>
				<StaticBoot />
			</StrictMode>
		)
		await new Promise((resolve) => setTimeout(resolve, 40))

		expect(calls(DEFAULT_TRACKER_ENDPOINT)).toHaveLength(1)
		expect(calls(config.ingestPath)).toHaveLength(1)
	})

	it('shares one request between calls made while it is in flight, and no later one', async () => {
		const [first, second] = await Promise.all([initTracker({ window }), initTracker({ window })])
		const third = await initTracker({ window })

		expect(calls(DEFAULT_TRACKER_ENDPOINT)).toHaveLength(2)
		for (const tracker of [first, second, third]) {
			tracker.destroy()
		}
	})
})
